import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getSession } from "../../../../../lib/auth";
import {
  foodBankContext,
  canEditInventory,
} from "../../../../../lib/food-bank";
import { withTransaction } from "../../../../../lib/db";
const Update = z.object({
  field: z.enum([
    "product_name",
    "brand",
    "category",
    "subcategory",
    "quantity",
    "unit",
    "lot_number",
    "expiration_date",
    "warehouse_zone",
    "bin_location",
    "condition",
    "source_name",
    "notes",
  ]),
  value: z.union([z.string(), z.number(), z.null()]),
  rowVersion: z.number().int().positive(),
  reason: z.string().min(3).max(300),
});
const columns = new Set(Update.shape.field.options);
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ itemId: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const context = await foodBankContext(session);
    if (!canEditInventory(context.role))
      throw new Error("Inventory edit permission required");
    const x = Update.parse(await request.json()),
      { itemId } = await ctx.params;
    if (!columns.has(x.field)) throw new Error("Field cannot be edited");
    const item = await withTransaction(async (client) => {
      const before = (
        await client.query(
          "SELECT * FROM inventory_items WHERE id=$1 AND site_id=$2 AND archived_at IS NULL FOR UPDATE",
          [itemId, context.siteId],
        )
      ).rows[0];
      if (!before) throw new Error("Inventory item not found");
      if (before.row_version !== x.rowVersion)
        throw new Error(
          "This row changed on another device. Refresh before editing.",
        );
      const after = (
        await client.query(
          `UPDATE inventory_items SET ${x.field}=$1,row_version=row_version+1,updated_by=$2,updated_at=now() WHERE id=$3 RETURNING *`,
          [x.value, session.userId, itemId],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO inventory_item_changes(inventory_item_id,organization_id,changed_by,before_value,after_value,change_reason) VALUES($1,$2,$3,$4,$5,$6)",
        [
          itemId,
          context.organizationId,
          session.userId,
          before,
          after,
          x.reason,
        ],
      );
      if (x.field === "quantity") {
        const delta = Number(after.quantity) - Number(before.quantity);
        if (delta !== 0)
          await client.query(
            "INSERT INTO inventory_transactions(organization_id,site_id,inventory_item_id,category,product_name,quantity,unit,direction,transaction_type,source,operator_id,approval_status,reviewer_id,approved_at,idempotency_key,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manual_adjustment','spreadsheet',$9,'approved',$9,now(),$10,$11)",
            [
              context.organizationId,
              context.siteId,
              itemId,
              after.category,
              after.product_name,
              Math.abs(delta),
              after.unit,
              delta > 0 ? "in" : "out",
              session.userId,
              `item-adjustment:${itemId}:${after.row_version}:${randomUUID()}`,
              {
                reason: x.reason,
                before: Number(before.quantity),
                after: Number(after.quantity),
              },
            ],
          );
      }
      return after;
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to edit item" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ itemId: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const context = await foodBankContext(session);
    if (!canEditInventory(context.role))
      throw new Error("Inventory edit permission required");
    const { itemId } = await ctx.params;
    await withTransaction(async (client) => {
      const before = (
        await client.query(
          "SELECT * FROM inventory_items WHERE id=$1 AND site_id=$2 AND archived_at IS NULL FOR UPDATE",
          [itemId, context.siteId],
        )
      ).rows[0];
      if (!before) throw new Error("Inventory item not found");
      const quantity = Number(before.quantity);
      if (quantity > 0)
        await client.query(
          "INSERT INTO inventory_transactions(organization_id,site_id,inventory_item_id,category,product_name,quantity,unit,direction,transaction_type,source,operator_id,approval_status,reviewer_id,approved_at,idempotency_key,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'out','manual_adjustment','spreadsheet',$8,'approved',$8,now(),$9,$10)",
          [
            context.organizationId,
            context.siteId,
            itemId,
            before.category,
            before.product_name,
            quantity,
            before.unit,
            session.userId,
            `item-remove:${itemId}:${before.row_version}:${randomUUID()}`,
            { reason: "Inventory row removed", before: quantity, after: 0 },
          ],
        );
      const after = (
        await client.query(
          "UPDATE inventory_items SET quantity=0,archived_at=now(),row_version=row_version+1,updated_by=$1,updated_at=now() WHERE id=$2 RETURNING *",
          [session.userId, itemId],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO inventory_item_changes(inventory_item_id,organization_id,changed_by,before_value,after_value,change_reason) VALUES($1,$2,$3,$4,$5,'Inventory row removed')",
        [itemId, context.organizationId, session.userId, before, after],
      );
    });
    return NextResponse.json({ removed: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to remove item" },
      { status: 400 },
    );
  }
}
