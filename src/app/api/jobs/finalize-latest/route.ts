import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLCTD } from "@/lib/scan_date";
import { finalizeSignals } from "@/lib/finalize_signals";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
} from "@/lib/strategy/coreMomentumSwing";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";

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

    const date_used = lctd.scan_date;
    const strategies = [CORE_MOMENTUM_DEFAULT_VERSION, TREND_HOLD_DEFAULT_VERSION];
    const results_by_strategy: Record<string, unknown> = {};

    for (const strategy_version of strategies) {
      const result = await finalizeSignals({
        supabase,
        date: date_used,
        universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
        strategy_version,
      });
      if (!result.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: `Finalization failed for ${strategy_version}: ${result.error ?? "unknown"}`,
            detail: null,
          },
          { status: 500 }
        );
      }
      results_by_strategy[strategy_version] = {
        total: result.total ?? 0,
        buy: result.buy ?? 0,
        watch: result.watch ?? 0,
        avoid: result.avoid ?? 0,
      };
    }

    return NextResponse.json({
      ok: true,
      date_used,
      lctd_source: lctd.lctd_source,
      results_by_strategy,
    });
  } catch (e: unknown) {
    console.error("finalize-latest error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

