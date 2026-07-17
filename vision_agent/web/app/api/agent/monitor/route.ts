import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { foodBankContext } from "../../../../lib/food-bank";
import { sql } from "../../../../lib/db";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    const context = await foodBankContext(session);
    const items =
      await sql()`SELECT * FROM inventory_items WHERE site_id=${context.siteId} AND archived_at IS NULL`;
    const now = Date.now();
    const week = now + 7 * 86400000;
    const recommendations = [];
    const expiring = items.filter(
      (item) =>
        item.expiration_date &&
        new Date(String(item.expiration_date)).getTime() >= now &&
        new Date(String(item.expiration_date)).getTime() <= week,
    );
    if (expiring.length)
      recommendations.push({
        type: "expiration",
        title: `${expiring.length} lots expire within seven days`,
        explanation:
          "Prioritize these lots using first-expired, first-out handling.",
        proposedAction: "Prepare a priority distribution list",
        requiresHumanApproval: true,
      });
    const low = items.filter((item) => Number(item.quantity) <= 10);
    if (low.length)
      recommendations.push({
        type: "low_stock",
        title: `${low.length} items are at or below 10 units`,
        explanation:
          "Review demand before requesting replenishment. The agent cannot order on its own.",
        proposedAction: "Prepare a replenishment review",
        requiresHumanApproval: true,
      });
    const missing = items.filter(
      (item) => !item.warehouse_zone || !item.bin_location,
    );
    if (missing.length)
      recommendations.push({
        type: "missing_location",
        title: `${missing.length} items need warehouse locations`,
        explanation:
          "Complete location data so volunteers can find stock quickly.",
        proposedAction: "Request location assignment",
        requiresHumanApproval: true,
      });
    return NextResponse.json({
      context,
      summary: {
        items: items.length,
        totalUnits: items.reduce(
          (total, item) => total + Number(item.quantity),
          0,
        ),
        expiring: expiring.length,
        lowStock: low.length,
        missingLocations: missing.length,
      },
      recommendations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agent review failed" },
      { status: 400 },
    );
  }
}
