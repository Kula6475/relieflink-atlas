import { sql } from "./db";
import type { Session } from "./auth";

export type FoodBankContext = {
  organizationId: string;
  organizationName: string;
  siteId: string;
  siteName: string;
  role: string;
  agentId: string;
  agentName: string;
};

export async function foodBankContext(session: Session): Promise<FoodBankContext> {
  const rows = await sql()`SELECT o.id organization_id, o.name organization_name,
      s.id site_id, s.name site_name, m.role, a.id agent_id, a.name agent_name
    FROM organization_memberships m
    JOIN organizations o ON o.id=m.organization_id
    JOIN sites s ON s.organization_id=o.id AND (m.site_id=s.id OR m.site_id IS NULL)
    JOIN agents a ON a.organization_id=o.id AND a.site_id=s.id AND a.agent_type='site' AND a.active=true
    WHERE m.user_id=${session.userId} AND o.organization_type='food_bank'
    ORDER BY m.created_at LIMIT 1`;
  if (!rows[0]) throw new Error("This account is not assigned to a registered food bank");
  return {
    organizationId: String(rows[0].organization_id), organizationName: String(rows[0].organization_name),
    siteId: String(rows[0].site_id), siteName: String(rows[0].site_name), role: String(rows[0].role),
    agentId: String(rows[0].agent_id), agentName: String(rows[0].agent_name),
  };
}

export function canEditInventory(role: string) {
  return ["contributor", "reviewer", "administrator"].includes(role);
}
