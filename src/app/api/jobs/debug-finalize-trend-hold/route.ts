import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLCTD } from "@/lib/scan_date";
import { finalizeSignals } from "@/lib/finalize_signals";

const UNIVERSE_SLUG = "core_800";
const STRATEGY_VERSION = "v1_trend_hold";

export async function POST() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;

    const lctd = await getLCTD(supabase);
    if (!lctd.ok || !lctd.scan_date) {
      return NextResponse.json(
        { ok: false, error: lctd.error ?? "Unable to resolve LCTD", detail: null },
        { status: 500 }
      );
    }

    const result = await finalizeSignals({
      supabase,
      date: lctd.scan_date,
      universe_slug: UNIVERSE_SLUG,
      strategy_version: STRATEGY_VERSION,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Trend hold finalization failed", detail: result },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      date_used: lctd.scan_date,
      universe_slug: UNIVERSE_SLUG,
      strategy_version: STRATEGY_VERSION,
      finalize_debug: result,
    });
  } catch (e: unknown) {
    console.error("debug-finalize-trend-hold error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

