import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rebuildCanonicalUniverses } from "@/lib/canonical_universes";
import { getLCTD } from "@/lib/scan_status";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const expected = process.env.ADMIN_RUN_SCAN_KEY;
  if (!expected) return true;
  return req.headers.get("x-admin-key") === expected;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const polygonApiKey = process.env.POLYGON_API_KEY;
    if (!supabaseUrl || !serviceKey || !polygonApiKey) {
      return NextResponse.json({ ok: false, error: "Missing Supabase or Polygon server configuration" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as { date?: string; market_cap_concurrency?: number };
    const lctd = await getLCTD(supabase);
    const scanDate = String(body.date ?? lctd.lctd ?? "").trim();
    if (!scanDate) return NextResponse.json({ ok: false, error: "No completed Polygon bar date available" }, { status: 409 });

    const summary = await rebuildCanonicalUniverses({
      supabase,
      polygonApiKey,
      scanDate,
      marketCapConcurrency: Number.isFinite(Number(body.market_cap_concurrency))
        ? Math.max(1, Math.min(40, Number(body.market_cap_concurrency)))
        : 24,
    });
    return NextResponse.json(summary);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[canonical-universe-rebuild] failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
