import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "../../../lib/auth";
import { sql } from "../../../lib/db";
import { decidePersistentApproval } from "../../../lib/atlas/persistent-approvals";
import {
  dispatchJudgeDemo,
  loadJudgeDemo,
  receiveJudgeDemo,
  reviseJudgeDemoQuantity,
  seedJudgeDemo,
} from "../../../lib/atlas/judge-demo";

export const maxDuration = 45;
const Action = z.object({
  action: z.enum([
    "seed",
    "approve_next",
    "revise",
    "dispatch",
    "receive",
    "run_all",
  ]),
  quantity: z.number().int().positive().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  try {
    return NextResponse.json(await loadJudgeDemo());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Demo unavailable" },
      { status: 500 },
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
    const { action, quantity } = Action.parse(await request.json());
    if (action === "seed") await seedJudgeDemo(session);
    if (action === "revise") {
      if (!quantity) throw new Error("A revised ideal quantity is required");
      await reviseJudgeDemoQuantity(quantity);
    }
    if (action === "approve_next") {
      const pending =
        await sql()`SELECT a.id FROM required_approvals a JOIN transfer_proposals p ON p.id=a.transfer_proposal_id JOIN negotiations n ON n.id=p.negotiation_id WHERE n.region='judge-demo-v1' AND a.status='pending' ORDER BY a.created_at LIMIT 1`;
      if (!pending[0])
        throw new Error("All four approvals are already complete");
      await decidePersistentApproval({
        approvalId: String(pending[0].id),
        decision: "approved",
        note: "Judge demo human approval",
        session,
      });
    }
    if (action === "dispatch") await dispatchJudgeDemo(session);
    if (action === "receive") await receiveJudgeDemo(session);
    if (action === "run_all") {
      await seedJudgeDemo(session);
      for (let index = 0; index < 4; index++) {
        const pending =
          await sql()`SELECT a.id FROM required_approvals a JOIN transfer_proposals p ON p.id=a.transfer_proposal_id JOIN negotiations n ON n.id=p.negotiation_id WHERE n.region='judge-demo-v1' AND a.status='pending' ORDER BY a.created_at LIMIT 1`;
        if (pending[0])
          await decidePersistentApproval({
            approvalId: String(pending[0].id),
            decision: "approved",
            note: "Judge demo automated walkthrough",
            session,
          });
      }
      await dispatchJudgeDemo(session);
      await receiveJudgeDemo(session);
    }
    return NextResponse.json(await loadJudgeDemo());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Demo action failed" },
      { status: 400 },
    );
  }
}
