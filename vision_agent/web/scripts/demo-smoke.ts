import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local"), quiet: true });
config({ path: join(process.cwd(), ".env"), quiet: true });
import { sql } from "../lib/db";
import type { Session } from "../lib/auth";
import { decidePersistentApproval } from "../lib/atlas/persistent-approvals";
import {
  dispatchJudgeDemo,
  loadJudgeDemo,
  receiveJudgeDemo,
  seedJudgeDemo,
} from "../lib/atlas/judge-demo";

async function main() {
  const users =
    await sql()`SELECT id,email,display_name,global_role FROM users ORDER BY created_at LIMIT 1`;
  if (!users[0])
    throw new Error("Register one user before running the demo smoke test");
  const session: Session = {
    userId: String(users[0].id),
    email: String(users[0].email),
    displayName: String(users[0].display_name),
    globalRole: users[0].global_role === "administrator" ? "administrator" : "member",
  };
  await seedJudgeDemo(session);
  for (let index = 0; index < 4; index++) {
    const pending =
      await sql()`SELECT a.id FROM required_approvals a JOIN transfer_proposals p ON p.id=a.transfer_proposal_id JOIN negotiations n ON n.id=p.negotiation_id WHERE n.region='judge-demo-v1' AND a.status='pending' ORDER BY a.created_at LIMIT 1`;
    if (pending[0])
      await decidePersistentApproval({
        approvalId: String(pending[0].id),
        decision: "approved",
        note: "Automated end-to-end verification",
        session,
      });
  }
  await dispatchJudgeDemo(session);
  await dispatchJudgeDemo(session);
  await receiveJudgeDemo(session);
  await receiveJudgeDemo(session);
  const state = (await loadJudgeDemo()) as any;
  if (state.shortage !== 0 || state.shipment?.status !== "received")
    throw new Error(
      `Demo verification failed: ${JSON.stringify({ shortage: state.shortage, shipment: state.shipment })}`,
    );
  console.log(
    "Judge demo passed: four approvals, reservation, idempotent dispatch/receipt, shortage 0",
  );
}
void main();
