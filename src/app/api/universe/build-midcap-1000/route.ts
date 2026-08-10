import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Legacy single-universe builder retired. Use POST /api/admin/rebuild-universes so mid-cap membership uses the canonical snapshot and rules.",
      replacement: "/api/admin/rebuild-universes",
    },
    { status: 410 }
  );
}
