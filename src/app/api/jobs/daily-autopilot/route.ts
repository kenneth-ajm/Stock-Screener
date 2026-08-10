import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CORE_MOMENTUM_DEFAULT_VERSION,
} from "@/lib/strategy/coreMomentumSwing";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";
import {
  runScanPipeline,
  type ScanEngineClient,
} from "@/lib/scan_engine";
import { getLCTD } from "@/lib/scan_date";
import { runDiagnosticsWithClient } from "@/lib/diagnostics";
import { finalizeSignals } from "@/lib/finalize_signals";
import { refreshSpyRegimeForLctd } from "@/lib/spy_regime";
import { getMarketDataProvider } from "@/lib/market-data";
import { isUsMarketTradingDay, latestCompletedUsTradingDay, shiftIsoDate } from "@/lib/market-calendar";

// Production daily market-data refresh path.
// Acquisition is provider-neutral; scans continue to read normalized cached price_bars.
const UNIVERSE_SLUG = "core_800";
const STATUS_KEY = "daily_autopilot_core_800";

function nowIso() {
  return new Date().toISOString();
}

function candidateIngestDates(lctdDate: string, lookbackDays = 7) {
  const latestCompletedSession = latestCompletedUsTradingDay();
  const out: string[] = [];
  const push = (d: string) => {
    if (!d) return;
    if (!out.includes(d)) out.push(d);
  };
  for (let daysBack = 0; daysBack <= lookbackDays; daysBack += 1) {
    const candidate = shiftIsoDate(latestCompletedSession, -daysBack);
    if (isUsMarketTradingDay(candidate)) push(candidate);
  }
  push(lctdDate);
  return out;
}

async function ingestGroupedForDate(opts: {
  supabase: any;
  date: string;
  symbols: string[];
}) {
  const supa = opts.supabase as any;
  const provider = getMarketDataProvider();
  if (!provider.configured) throw new Error(`${provider.label} market data is not configured`);
  const grouped = await provider.fetchGroupedDailyBars(opts.date);
  const groupedRows = grouped.bars;

  const symbolSet = new Set(opts.symbols);
  const { data: existingRows, error: existingErr } = await supa
    .from("price_bars")
    .select("symbol")
    .eq("date", opts.date)
    .in("symbol", Array.from(symbolSet))
    .eq("source", provider.id);
  if (existingErr) throw existingErr;
  const alreadyPresent = new Set(
    (existingRows ?? [])
      .map((r: { symbol?: string | null }) => String(r.symbol ?? "").toUpperCase())
      .filter(Boolean)
  );

  const upserts: Array<{
    symbol: string;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source: string;
  }> = [];

  for (const row of groupedRows) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    if (!symbolSet.has(symbol)) continue;
    if (alreadyPresent.has(symbol)) continue;
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Number(row.volume);
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }
    upserts.push({
      symbol,
      date: opts.date,
      open,
      high,
      low,
      close,
      volume: Math.round(volume),
      source: provider.id,
    });
  }

  if (upserts.length === 0) {
    return {
      date: opts.date,
      provider: provider.id,
      provider_path: `/v2/aggs/grouped/locale/us/market/stocks/${opts.date}`,
      provider_adjusted: grouped.adjusted,
      provider_http_status: grouped.http_status,
      provider_response_status: grouped.response_status,
      grouped_rows_total: groupedRows.length,
      eligible_symbols: symbolSet.size,
      already_present_rows: alreadyPresent.size,
      bars_upserted: 0,
    };
  }
  const chunkSize = 400;
  let written = 0;
  for (let i = 0; i < upserts.length; i += chunkSize) {
    const chunk = upserts.slice(i, i + chunkSize) as any[];
    const { error } = await supa.from("price_bars").upsert(chunk, {
      onConflict: "symbol,date",
    });
    if (error) throw error;
    written += chunk.length;
  }
  return {
    date: opts.date,
    provider: provider.id,
    provider_path: `/v2/aggs/grouped/locale/us/market/stocks/${opts.date}`,
    provider_adjusted: grouped.adjusted,
    provider_http_status: grouped.http_status,
    provider_response_status: grouped.response_status,
    grouped_rows_total: groupedRows.length,
    eligible_symbols: symbolSet.size,
    already_present_rows: alreadyPresent.size,
    bars_upserted: written,
  };
}

async function runFullStrategyScan(opts: {
  supabase: any;
  universe_slug: string;
  strategy_version: string;
  scan_date_used: string;
  total_members: number;
}) {
  const batchLimit = 200;
  const batches = Math.max(1, Math.ceil(opts.total_members / batchLimit));
  let processed = 0;
  let scored = 0;
  let upserted = 0;
  let regime_state: string | null = null;

  for (let i = 0; i < batches; i += 1) {
    const result = await runScanPipeline({
      supabase: opts.supabase,
      universe_slug: opts.universe_slug,
      strategy_version: opts.strategy_version,
      scan_date: opts.scan_date_used,
      offset: i * batchLimit,
      limit: batchLimit,
      finalize: false,
    });
    if (!result.ok) throw new Error(result.error ?? `Batch ${i + 1} failed`);

    processed += Number(result.processed ?? 0);
    scored += Number(result.scored ?? 0);
    upserted += Number(result.upserted ?? 0);
    regime_state = String(result.regime_state ?? regime_state ?? "FAVORABLE");
    if (Number(result.processed ?? 0) < batchLimit) break;
  }

  return {
    processed,
    scored,
    upserted,
    regime_state,
  };
}

async function writeStatus(payload: Record<string, unknown>) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;
    await supabase.from("system_status").upsert(
      {
        key: STATUS_KEY,
        value: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
  } catch (e) {
    console.error("daily-autopilot status write failed", e);
  }
}

export async function runAutopilot() {
  const startedAt = Date.now();
  const startedAtIso = nowIso();
  const marketDataProvider = getMarketDataProvider();
  console.info("[daily-autopilot] run:start", {
    started_at: startedAtIso,
    universe_slug: UNIVERSE_SLUG,
  });
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as ScanEngineClient;
  const supa = supabase as any;

  const lctd = await getLCTD(supa);
  if (!lctd.ok || !lctd.scan_date) {
    throw new Error(lctd.error ?? "Unable to resolve scan date");
  }
  const lctdDate = lctd.scan_date;

  const { data: universe, error: universeErr } = await supa
    .from("universes")
    .select("id")
    .eq("slug", UNIVERSE_SLUG)
    .maybeSingle();
  if (universeErr) throw new Error(universeErr.message);
  if (!universe?.id) throw new Error(`Universe not found: ${UNIVERSE_SLUG}`);

  const { data: members, error: membersErr } = await supa
    .from("universe_members")
    .select("symbol")
    .eq("universe_id", universe.id)
    .eq("active", true)
    .order("symbol", { ascending: true });
  if (membersErr) throw new Error(membersErr.message);
  const symbols = (members ?? [])
    .map((m: { symbol?: string | null }) => String(m.symbol ?? "").toUpperCase())
    .filter(Boolean);
  const symbolsWithSpy = Array.from(new Set([...symbols, "SPY"]));

  const candidateDates = candidateIngestDates(lctdDate, 7);
  const ingest_attempts: Array<Record<string, unknown>> = [];
  let scanDate: string | null = null;
  let barsUpsertedTotal = 0;
  for (const candidate of candidateDates) {
    const ingestStarted = nowIso();
    console.info("[daily-autopilot] grouped_ingest:start", {
      date: candidate,
      started_at: ingestStarted,
      symbol_count: symbolsWithSpy.length,
    });
    let ingestResult: Record<string, unknown> | null = null;
    let ingestError: string | null = null;
    try {
      ingestResult = await ingestGroupedForDate({
        supabase: supa,
        date: candidate,
        symbols: symbolsWithSpy,
      });
      barsUpsertedTotal += Number((ingestResult as any)?.bars_upserted ?? 0);
    } catch (e: unknown) {
      ingestError = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    }
    const { data: spyBar } = await supa
      .from("price_bars")
      .select("date")
      .eq("symbol", "SPY")
      .eq("source", marketDataProvider.id)
      .eq("date", candidate)
      .limit(1)
      .maybeSingle();
    const hasSpyBar = Boolean(spyBar?.date);
    const attemptMeta = {
      ...(ingestResult ?? {}),
      error: ingestError,
      started_at: ingestStarted,
      ended_at: nowIso(),
      has_spy_bar_after_ingest: hasSpyBar,
    };
    ingest_attempts.push(attemptMeta);
    console.info("[daily-autopilot] grouped_ingest:end", attemptMeta);
    if (hasSpyBar) {
      scanDate = candidate;
      break;
    }
  }
  if (!scanDate) {
    scanDate = lctdDate;
  }
  const selectedAttempt = ingest_attempts.find((a) => a?.has_spy_bar_after_ingest && a?.date === scanDate) ?? null;
  const regime = await refreshSpyRegimeForLctd({ supabase: supa, lctd: scanDate });

  const momentumRun = await runFullStrategyScan({
    supabase: supa,
    universe_slug: UNIVERSE_SLUG,
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    scan_date_used: scanDate,
    total_members: symbols.length,
  });
  console.info("[daily-autopilot] scan:strategy_complete", {
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    scan_date_used: scanDate,
    processed: momentumRun.processed,
    scored: momentumRun.scored,
    upserted: momentumRun.upserted,
  });

  const trendRun = await runFullStrategyScan({
    supabase: supa,
    universe_slug: UNIVERSE_SLUG,
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    scan_date_used: scanDate,
    total_members: symbols.length,
  });
  console.info("[daily-autopilot] scan:strategy_complete", {
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    scan_date_used: scanDate,
    processed: trendRun.processed,
    scored: trendRun.scored,
    upserted: trendRun.upserted,
  });

  const finalizations: Record<string, any> = {};
  for (const strategy_version of [CORE_MOMENTUM_DEFAULT_VERSION, TREND_HOLD_DEFAULT_VERSION]) {
    const finalization = await finalizeSignals({
      supabase: supa,
      date: scanDate,
      universe_slug: UNIVERSE_SLUG,
      strategy_version,
    });
    if (!finalization.ok) {
      throw new Error(`Finalization failed for ${strategy_version}: ${finalization.error ?? "unknown"}`);
    }
    finalizations[strategy_version] = finalization;
  }

  const diagnostics = await runDiagnosticsWithClient(supa);
  const diagnostics_summary = {
    ok: diagnostics.ok,
    lctd_vs_scans_ok: diagnostics.checks.lctd_vs_scans.ok,
    caps_ok: diagnostics.checks.caps.ok,
  };
  if (!diagnostics_summary.lctd_vs_scans_ok || !diagnostics_summary.caps_ok) {
    throw new Error(`Autopilot diagnostics failed: ${JSON.stringify(diagnostics_summary)}`);
  }

  const result = {
    ok: true,
    started_at: startedAtIso,
    ended_at: nowIso(),
    scan_date: scanDate,
    scan_date_used: scanDate,
    lctd_before_ingest: lctdDate,
    ingest_candidate_dates: candidateDates,
    lctd_source: lctd.lctd_source,
    market_data_provider: marketDataProvider.id,
    bars_upserted: barsUpsertedTotal,
    ingest_attempts,
    ingest_selected_attempt: selectedAttempt,
    regime_state: regime.state ?? "FAVORABLE",
    regime_date_used: regime.regime_date_used,
    spy_regime_stale: regime.regime_stale,
    momentum: {
      buys: Number(finalizations[CORE_MOMENTUM_DEFAULT_VERSION]?.buy ?? 0),
      watch: Number(finalizations[CORE_MOMENTUM_DEFAULT_VERSION]?.watch ?? 0),
    },
    trend: {
      buys: Number(finalizations[TREND_HOLD_DEFAULT_VERSION]?.buy ?? 0),
      watch: Number(finalizations[TREND_HOLD_DEFAULT_VERSION]?.watch ?? 0),
    },
    finalization: finalizations,
    diagnostics_summary,
    duration_ms: Date.now() - startedAt,
  };
  console.info("[daily-autopilot] run:end", {
    ended_at: nowIso(),
    ok: true,
    scan_date_used: result.scan_date_used,
    bars_upserted: result.bars_upserted,
    momentum: result.momentum,
    trend: result.trend,
    duration_ms: result.duration_ms,
  });
  return result;
}

export async function GET() {
  try {
    const result = await runAutopilot();
    await writeStatus({
      ok: true,
      started_at: result.started_at ?? null,
      ended_at: result.ended_at ?? null,
      scan_date: result.scan_date,
      date_used: result.scan_date_used,
      bars_upserted: result.bars_upserted,
      market_data_provider: result.market_data_provider,
      ingest_attempts: result.ingest_attempts ?? [],
      ingest_candidate_dates: result.ingest_candidate_dates ?? [],
      ingest_selected_attempt: result.ingest_selected_attempt ?? null,
      lctd_before_ingest: result.lctd_before_ingest ?? null,
      regime_state: result.regime_state,
      regime_date_used: result.regime_date_used,
      spy_regime_stale: result.spy_regime_stale,
      buy_count: result.momentum.buys,
      watch_count: result.momentum.watch,
      trend_buy_count: result.trend.buys,
      trend_watch_count: result.trend.watch,
      diagnostics_summary: result.diagnostics_summary,
      duration_ms: result.duration_ms,
      error: null,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error("daily-autopilot error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    await writeStatus({
      ok: false,
      started_at: null,
      ended_at: nowIso(),
      scan_date: null,
      date_used: null,
      bars_upserted: 0,
      buy_count: 0,
      watch_count: 0,
      trend_buy_count: 0,
      trend_watch_count: 0,
      duration_ms: 0,
      error,
    });
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
