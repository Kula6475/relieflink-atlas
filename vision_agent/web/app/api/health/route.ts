import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "relieflink-atlas",
    release: "hackathon-final",
    commit: process.env.VERCEL_GIT_COMMIT_SHA || "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF || "local",
    services: {
      database: Boolean(process.env.DATABASE_URL),
      openai: Boolean(process.env.OPENAI_API_KEY),
      roboflow: Boolean(process.env.ROBOFLOW_API_KEY && process.env.YOLO_MODEL_ID),
      weather: true,
      fema: true,
    },
    checkedAt: new Date().toISOString(),
  });
}
