import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { foodBankContext } from "../../../lib/food-bank";
import { sql } from "../../../lib/db";

export async function GET() {
  const session=await getSession();
  if(!session) return NextResponse.json({error:"Authentication required"},{status:401});
  const [context, rows]=await Promise.all([
    foodBankContext(session),
    sql()`SELECT s.id,s.name,s.address,s.county,s.state,s.latitude,s.longitude,s.service_radius_miles,
      a.id agent_id,a.name agent_name,
      COALESCE((SELECT sum(i.quantity) FROM inventory_items i WHERE i.site_id=s.id),0) inventory_units
      FROM sites s JOIN organizations o ON o.id=s.organization_id AND o.status='active'
      LEFT JOIN agents a ON a.site_id=s.id AND a.agent_type='site' AND a.active=true
      ORDER BY s.name`,
  ]);
  return NextResponse.json({context,foodBanks:rows});
}
