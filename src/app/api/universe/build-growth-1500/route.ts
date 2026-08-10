import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "growth_1500 is retired because the application did not have fundamental growth data to justify that label.",
      replacement: "/api/admin/rebuild-universes",
    },
    { status: 410 }
  );
}
