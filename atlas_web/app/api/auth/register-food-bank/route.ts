import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { setSession } from "../../../../lib/auth";
import { withTransaction } from "../../../../lib/db";

const Registration = z.object({
  foodBankName: z.string().min(3).max(160),
  address: z.string().min(5).max(240), county: z.string().min(2).max(100),
  state: z.string().length(2), latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180),
  phone: z.string().max(30).optional(), displayName: z.string().min(2).max(100),
  email: z.string().email(), password: z.string().min(12).max(200),
});

export async function POST(request: Request) {
  try {
    const input = Registration.parse(await request.json());
    const passwordHash = await hash(input.password, 12);
    const created = await withTransaction(async (client) => {
      const duplicate = await client.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [input.email]);
      if (duplicate.rowCount) throw new Error("An account already exists for this email");
      const organization = (await client.query("INSERT INTO organizations(name,organization_type) VALUES($1,'food_bank') RETURNING id", [input.foodBankName])).rows[0];
      const site = (await client.query(`INSERT INTO sites(organization_id,name,county,state,latitude,longitude,address,phone)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [organization.id,input.foodBankName,input.county,input.state.toUpperCase(),input.latitude,input.longitude,input.address,input.phone ?? null])).rows[0];
      const user = (await client.query(`INSERT INTO users(email,password_hash,display_name) VALUES(lower($1),$2,$3) RETURNING id,email,display_name,global_role`, [input.email,passwordHash,input.displayName])).rows[0];
      await client.query("INSERT INTO organization_memberships(organization_id,user_id,role,site_id) VALUES($1,$2,'administrator',$3)", [organization.id,user.id,site.id]);
      const agent = (await client.query(`INSERT INTO agents(organization_id,site_id,agent_type,name,configuration)
        VALUES($1,$2,'site',$3,$4) RETURNING id,name`, [organization.id,site.id,`${input.foodBankName} Inventory Agent`,JSON.stringify({monitoring:["inventory","expiration","locations"],humanApprovalRequired:true})])).rows[0];
      return { organization, site, user, agent };
    });
    await setSession({ userId:String(created.user.id), email:String(created.user.email), displayName:String(created.user.display_name), globalRole:"member" });
    return NextResponse.json({ ok:true, siteId:created.site.id, agent:created.agent, user:{displayName:created.user.display_name,email:created.user.email} }, { status:201 });
  } catch (error) {
    return NextResponse.json({ error:error instanceof Error ? error.message : "Registration failed" }, { status:400 });
  }
}
