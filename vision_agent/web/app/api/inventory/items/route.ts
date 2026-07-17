import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getSession } from "../../../../lib/auth";
import { foodBankContext, canEditInventory } from "../../../../lib/food-bank";
import { sql, withTransaction } from "../../../../lib/db";
const Item = z.object({
  productName: z.string().min(1).max(200),
  brand: z.string().max(120).nullable().optional(),
  category: z.string().min(1).max(80),
  subcategory: z.string().max(100).nullable().optional(),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1).max(40),
  lotNumber: z.string().max(100).nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  warehouseZone: z.string().max(100).nullable().optional(),
  binLocation: z.string().max(100).nullable().optional(),
  condition: z
    .enum(["good", "damaged", "quarantined", "expired"])
    .default("good"),
  sourceName: z.string().max(160).nullable().optional(),
  barcode: z.string().max(100).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  intakeMethod: z.enum(["manual", "csv", "vision"]).default("manual"),
  visionConfidence: z.number().min(0).max(1).nullable().optional(),
});
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const context = await foodBankContext(session),
      items =
        await sql()`SELECT * FROM inventory_items WHERE site_id=${context.siteId} ORDER BY expiration_date NULLS LAST,product_name`;
    return NextResponse.json({ context, items });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load inventory",
      },
      { status: 400 },
    );
  }
}
export async function POST(request: Request) {
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
    const x = Item.parse(await request.json());
    const item = await withTransaction(async (client) => {
      const created = (
        await client.query(
          "INSERT INTO inventory_items(organization_id,site_id,product_name,brand,category,subcategory,quantity,unit,lot_number,expiration_date,warehouse_zone,bin_location,condition,source_name,barcode,notes,intake_method,vision_confidence,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) RETURNING *",
          [
            context.organizationId,
            context.siteId,
            x.productName,
            x.brand ?? null,
            x.category,
            x.subcategory ?? null,
            x.quantity,
            x.unit,
            x.lotNumber ?? null,
            x.expirationDate || null,
            x.warehouseZone ?? null,
            x.binLocation ?? null,
            x.condition,
            x.sourceName ?? null,
            x.barcode ?? null,
            x.notes ?? null,
            x.intakeMethod,
            x.visionConfidence ?? null,
            session.userId,
          ],
        )
      ).rows[0];
      if (x.quantity > 0)
        await client.query(
          "INSERT INTO inventory_transactions(organization_id,site_id,inventory_item_id,category,product_name,quantity,unit,direction,transaction_type,source,operator_id,approval_status,reviewer_id,approved_at,idempotency_key,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'in','intake',$8,$9,'approved',$9,now(),$10,$11)",
          [
            context.organizationId,
            context.siteId,
            created.id,
            x.category,
            x.productName,
            x.quantity,
            x.unit,
            x.intakeMethod,
            session.userId,
            `item-intake:${created.id}:${randomUUID()}`,
            {
              humanApproved: true,
              visionConfidence: x.visionConfidence ?? null,
            },
          ],
        );
      return created;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid inventory item",
      },
      { status: 400 },
    );
  }
}
