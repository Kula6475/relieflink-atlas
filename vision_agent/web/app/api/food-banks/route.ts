import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { foodBankContext } from "../../../lib/food-bank";
import { sql } from "../../../lib/db";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const [context, foodBanks] = await Promise.all([
      foodBankContext(session),
      sql()`WITH inventory AS (
        SELECT site_id,category,sum(quantity)::float quantity
        FROM inventory_items WHERE condition='good' AND archived_at IS NULL GROUP BY site_id,category
      ), commitments AS (
        SELECT site_id,category,sum(quantity)::float committed FROM (
          SELECT site_id,category,quantity FROM inventory_reservations WHERE status IN('provisional','active')
          UNION ALL
          SELECT site_id,category,quantity FROM inventory_transactions
          WHERE direction='hold' AND approval_status='approved' AND source='atlas-interbank'
        ) held GROUP BY site_id,category
      )
      SELECT s.id,s.name,s.address,s.county,s.state,s.latitude,s.longitude,
        s.service_radius_miles,s.safety_stock_policy,a.name agent_name,
        COALESCE(sum(i.quantity),0)::float inventory_units,
        COALESCE(jsonb_agg(jsonb_build_object(
          'category',i.category,
          'quantity',i.quantity,
          'committed',COALESCE(c.committed,0),
          'safetyStock',COALESCE((s.safety_stock_policy->>i.category)::numeric,0),
          'available',GREATEST(0,i.quantity-COALESCE(c.committed,0)-COALESCE((s.safety_stock_policy->>i.category)::numeric,0))
        ) ORDER BY i.category) FILTER(WHERE i.category IS NOT NULL),'[]'::jsonb) inventory_summary
      FROM sites s
      JOIN organizations o ON o.id=s.organization_id AND o.status='active'
      LEFT JOIN agents a ON a.site_id=s.id AND a.agent_type='site' AND a.active=true
      LEFT JOIN inventory i ON i.site_id=s.id
      LEFT JOIN commitments c ON c.site_id=s.id AND c.category=i.category
      GROUP BY s.id,a.name ORDER BY s.name`,
    ]);
    return NextResponse.json({ context, foodBanks });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load food banks",
      },
      { status: 400 },
    );
  }
}
