import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "../../../../../../lib/auth";
import { foodBankContext } from "../../../../../../lib/food-bank";
import { withTransaction } from "../../../../../../lib/db";
const Input = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).default(""),
});
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const context = await foodBankContext(session);
    if (!["administrator", "reviewer"].includes(context.role))
      throw new Error("Administrator or reviewer permission required");
    const input = Input.parse(await request.json()),
      { runId } = await params;
    const run = await withTransaction(async (client) => {
      const lockedRun = (
        await client.query(
          "SELECT * FROM operational_runs WHERE id=$1 AND site_id=$2 FOR UPDATE",
          [runId, context.siteId],
        )
      ).rows[0];
      if (!lockedRun) throw new Error("ATLAS run not found");
      const consignment = (
        await client.query(
          "SELECT c.id consignment_id,c.source_site_id,c.destination_site_id,c.category,c.offered_quantity,c.status consignment_status,s.organization_id source_organization_id,s.safety_stock_policy FROM operational_consignments c JOIN sites s ON s.id=c.source_site_id WHERE c.operational_run_id=$1 FOR UPDATE OF c",
          [runId],
        )
      ).rows[0];
      if (!consignment) throw new Error("This run has no proposed consignment");
      const found = { ...lockedRun, ...consignment };
      if (found.consignment_status !== "proposed") return found;
      if (input.decision === "approved") {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `atlas:${found.source_site_id}:${String(found.category).toLowerCase()}`,
        ]);
        const inventoryRows = (
            await client.query(
              "SELECT quantity FROM inventory_items WHERE site_id=$1 AND lower(category)=lower($2) AND condition='good' FOR UPDATE",
              [found.source_site_id, found.category],
            )
          ).rows,
          onHand = inventoryRows.reduce(
            (sum, row) => sum + Number(row.quantity),
            0,
          ),
          safety = Number(
            (found.safety_stock_policy || {})[found.category] || 0,
          ),
          reservations = (
            await client.query(
              "SELECT COALESCE(sum(quantity),0)::float held FROM inventory_transactions WHERE site_id=$1 AND category=$2 AND direction='hold' AND approval_status='approved' AND idempotency_key LIKE 'operational-consignment:%'",
              [found.source_site_id, found.category],
            )
          ).rows[0],
          available = Math.max(0, onHand - safety - Number(reservations.held));
        if (Number(found.offered_quantity) > available)
          throw new Error(
            `Partner inventory changed; only ${available} units remain above safety stock`,
          );
        await client.query(
          "INSERT INTO inventory_transactions(organization_id,site_id,category,product_name,quantity,unit,direction,transaction_type,source,operator_id,approval_status,reviewer_id,approved_at,idempotency_key,metadata) VALUES($1,$2,$3,$3,$4,'units','hold','reservation','atlas-interbank',$5,'approved',$5,now(),$6,$7) ON CONFLICT(idempotency_key) DO NOTHING",
          [
            found.source_organization_id,
            found.source_site_id,
            found.category,
            found.offered_quantity,
            session.userId,
            `operational-consignment:${runId}:hold`,
            {
              destinationSiteId: found.destination_site_id,
              approvedByDestination: session.userId,
            },
          ],
        );
        await client.query(
          "UPDATE operational_consignments SET status='reserved',approved_quantity=offered_quantity,approved_by=$2,approved_at=now(),updated_at=now() WHERE id=$1",
          [found.consignment_id, session.userId],
        );
      } else
        await client.query(
          "UPDATE operational_consignments SET status='rejected',approved_by=$2,approved_at=now(),updated_at=now() WHERE id=$1",
          [found.consignment_id, session.userId],
        );
      await client.query(
        "UPDATE operational_runs SET status=$2,summary=summary||$3::jsonb,completed_at=now() WHERE id=$1",
        [
          runId,
          input.decision === "approved" ? "completed" : "failed",
          JSON.stringify({
            humanDecision: input.decision,
            decisionNote: input.note,
            decisionBy: session.userId,
            consignmentStatus:
              input.decision === "approved" ? "reserved" : "rejected",
          }),
        ],
      );
      await client.query(
        "UPDATE operational_steps SET status=$2 WHERE operational_run_id=$1 AND requires_human_approval=true",
        [runId, input.decision],
      );
      await client.query(
        "UPDATE transport_plans SET status=$2 WHERE operational_run_id=$1 AND status='proposed'",
        [runId, input.decision],
      );
      return (
        await client.query("SELECT * FROM operational_runs WHERE id=$1", [
          runId,
        ])
      ).rows[0];
    });
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Decision failed" },
      { status: 400 },
    );
  }
}
