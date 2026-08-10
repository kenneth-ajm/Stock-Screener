import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Legacy single-universe builder retired. Use POST /api/admin/rebuild-universes so all canonical cohorts are rebuilt from one coherent source snapshot.",
      replacement: "/api/admin/rebuild-universes",
    },
    { status: 410 }
  );
}
