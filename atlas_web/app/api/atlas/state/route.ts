import { NextResponse } from "next/server";

import { loadPersistentDashboardState } from "../../../../lib/atlas/repository";
import { getSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    return NextResponse.json(await loadPersistentDashboardState(session));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load ATLAS state" }, { status: 500 });
  }
}
