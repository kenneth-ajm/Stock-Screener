import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
} from "@/lib/strategy/coreMomentumSwing";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";
import {
  finalizeSignals,
  runScanPipeline,
  type ScanEngineClient,
} from "@/lib/scan_engine";
import { getLCTD } from "@/lib/scan_status";
import { runDiagnosticsWithClient } from "@/lib/diagnostics";

const BATCH_LIMIT = 100;

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

async function refreshRegimeNonFatal(supabase: any, lctd: string) {
  try {
    const { data: latestRows, error: latestErr } = await supabase
      .from("price_bars")
      .select("date,close")
      .eq("symbol", "SPY")
      .lte("date", lctd)
      .order("date", { ascending: false })
      .limit(260);
    if (latestErr) throw latestErr;
    const rows = Array.isArray(latestRows) ? latestRows : [];
    if (!rows.length) {
      return { ok: false, error: "No SPY bars available" };
    }
    if (rows.length < 200) {
      return { ok: false, error: "Not enough SPY bars to compute regime" };
    }
    const latest = rows[0];
    const asc = [...rows].reverse();
    const closes = asc.map((r: any) => Number(r.close));
    const sma200 = sma(closes, 200);
    if (!sma200 || !Number.isFinite(Number(latest.close))) {
      return { ok: false, error: "Unable to compute SPY regime" };
    }
    const close = Number(latest.close);
    const state = close > sma200 ? "FAVORABLE" : "DEFENSIVE";
    const regimeDate = String(latest.date);
    const { error: upErr } = await supabase.from("market_regime").upsert(
      {
        symbol: "SPY",
        date: regimeDate,
        close,
        sma200,
        state,
      },
      { onConflict: "symbol,date" }
    );
    if (upErr) throw upErr;
    return { ok: true, regime_state: state, regime_date_used: regimeDate };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    return { ok: false, error };
  }
}

async function rescanStrategy(opts: {
  supabase: any;
  universe_slug: string;
  strategy_version: string;
  scan_date: string;
  total_members: number;
}) {
  const batches = Math.max(1, Math.ceil(opts.total_members / BATCH_LIMIT));
  let batches_ok = 0;
  let batches_failed = 0;
  let first_error: unknown = null;
  let processed = 0;
  let scored = 0;
  let upserted = 0;

  for (let i = 0; i < batches; i += 1) {
    const offset = i * BATCH_LIMIT;
    const result = await runScanPipeline({
      supabase: opts.supabase,
      universe_slug: opts.universe_slug,
      strategy_version: opts.strategy_version,
      scan_date: opts.scan_date,
      offset,
      limit: BATCH_LIMIT,
      finalize: false,
    });
    if (!result.ok) {
      batches_failed += 1;
      if (!first_error) first_error = { batch: i, offset, error: result.error ?? "Batch failed" };
      continue;
    }

    batches_ok += 1;
    processed += Number(result.processed ?? 0);
    scored += Number(result.scored ?? 0);
    upserted += Number(result.upserted ?? 0);
    if (Number(result.processed ?? 0) < BATCH_LIMIT) break;
  }

  const finalization = await finalizeSignals({
    supabase: opts.supabase,
    date: opts.scan_date,
    universe_slug: opts.universe_slug,
    strategy_version: opts.strategy_version,
  });

  return {
    strategy_version: opts.strategy_version,
    batches_ok,
    batches_failed,
    first_error,
    processed,
    scored,
    upserted,
    finalization,
    ok: batches_ok > 0 && finalization.ok,
  };
}

export async function POST() {
  const startedAt = Date.now();
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as ScanEngineClient;
    const supa = supabase as any;

    const lctdStatus = await getLCTD(supa);
    if (!lctdStatus.lctd) {
      return NextResponse.json(
        { ok: false, error: "Unable to resolve LCTD from price_bars", detail: null },
        { status: 500 }
      );
    }
    const lctd = lctdStatus.lctd;

    const { count: futureCount, error: futureCountErr } = await supa
      .from("daily_scans")
      .select("symbol", { count: "exact", head: true })
      .eq("universe_slug", CORE_MOMENTUM_DEFAULT_UNIVERSE)
      .gt("date", lctd);
    if (futureCountErr) throw futureCountErr;

    const { error: deleteErr } = await supa
      .from("daily_scans")
      .delete()
      .eq("universe_slug", CORE_MOMENTUM_DEFAULT_UNIVERSE)
      .gt("date", lctd);
    if (deleteErr) throw deleteErr;

    const { data: universeRow, error: universeErr } = await supa
      .from("universes")
      .select("id")
      .eq("slug", CORE_MOMENTUM_DEFAULT_UNIVERSE)
      .maybeSingle();
    if (universeErr || !universeRow?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: `Universe not found: ${CORE_MOMENTUM_DEFAULT_UNIVERSE}`,
          detail: universeErr?.message ?? null,
        },
        { status: 400 }
      );
    }

    const { count: memberCount, error: memberErr } = await supa
      .from("universe_members")
      .select("symbol", { count: "exact", head: true })
      .eq("universe_id", universeRow.id)
      .eq("active", true);
    if (memberErr) throw memberErr;
    const totalMembers = Number(memberCount ?? 0);

    const strategies = [CORE_MOMENTUM_DEFAULT_VERSION, TREND_HOLD_DEFAULT_VERSION];
    const rescanned = [];
    for (const strategy_version of strategies) {
      rescanned.push(
        await rescanStrategy({
          supabase: supa,
          universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
          strategy_version,
          scan_date: lctd,
          total_members: totalMembers,
        })
      );
    }

    const regime = await refreshRegimeNonFatal(supa, lctd);
    const diagnostics = await runDiagnosticsWithClient(supa);
    const diagnosticsSummary = {
      ok: diagnostics.ok,
      lctd_vs_scans_ok: diagnostics.checks.lctd_vs_scans.ok,
      caps_ok: diagnostics.checks.caps.ok,
      regime_ok: diagnostics.checks.regime_freshness.ok,
    };

    const response = {
      ok: diagnosticsSummary.lctd_vs_scans_ok && diagnosticsSummary.caps_ok,
      lctd,
      lctd_source: lctdStatus.source,
      deleted_future_rows: Number(futureCount ?? 0),
      rescanned_strategies: rescanned,
      regime_refresh: regime,
      diagnostics_summary: diagnosticsSummary,
      duration_ms: Date.now() - startedAt,
    };

    return NextResponse.json(response, { status: response.ok ? 200 : 500 });
  } catch (e: unknown) {
    console.error("repair-latest-scan-state error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

