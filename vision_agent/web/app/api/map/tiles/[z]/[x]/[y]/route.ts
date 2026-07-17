import { NextResponse } from "next/server";

const coordinate = /^\d+$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const raw = await context.params;
  const z = raw.z;
  const x = raw.x;
  const y = raw.y.replace(/\.png$/, "");
  if (![z, x, y].every((value) => coordinate.test(value)) || Number(z) > 19)
    return NextResponse.json({ error: "Invalid map tile" }, { status: 400 });
  try {
    const response = await fetch(
      `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
      {
        headers: {
          "User-Agent": "ReliefLink-ATLAS/1.0 (food-bank coordination demo)",
        },
        next: { revalidate: 86400 },
      },
    );
    if (!response.ok) throw new Error(`Tile provider returned ${response.status}`);
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
