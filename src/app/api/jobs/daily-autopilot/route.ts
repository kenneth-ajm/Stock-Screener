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
import {
  CORE_UNIVERSE_SLUG,
  LEGACY_MOMENTUM_UNIVERSE_SLUG,
  MIDCAP_UNIVERSE_SLUG,
} from "@/lib/strategy_universe";
import { fetchActiveUsCommonSymbols } from "@/lib/universe_reference";

// Production daily market-data refresh path.
// Acquisition is provider-neutral; scans continue to read normalized cached price_bars.
const MOMENTUM_STRATEGY_VERSION = "v1";
const INGEST_UNIVERSE_SLUGS = [
  CORE_UNIVERSE_SLUG,
  LEGACY_MOMENTUM_UNIVERSE_SLUG,
  MIDCAP_UNIVERSE_SLUG,
] as const;
const STATUS_KEY = "daily_autopilot_core_800";

export const maxDuration = 300;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(label: string, operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = 500 * 2 ** (attempt - 1);
      console.warn("[daily-autopilot] retry", {
        label,
        attempt,
        delay_ms: delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
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

async function loadAllActiveUniverseSymbols(opts: {
  supabase: any;
  universeId: string;
  universeSlug: string;
}) {
  const pageSize = 1000;
  const symbols: string[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data: members, error } = await opts.supabase
      .from("universe_members")
      .select("symbol")
      .eq("universe_id", opts.universeId)
      .eq("active", true)
      .order("symbol", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${opts.universeSlug}: ${error.message}`);
    const page = (members ?? [])
      .map((member: { symbol?: string | null }) => String(member.symbol ?? "").trim().toUpperCase())
      .filter(Boolean);
    symbols.push(...page);
    if (page.length < pageSize) break;
  }
  return Array.from(new Set(symbols));
}

async function ingestGroupedForDate(opts: {
  supabase: any;
  date: string;
  symbols: string[];
}) {
  const supa = opts.supabase as any;
  const provider = getMarketDataProvider();
  if (!provider.configured) throw new Error(`${provider.label} market data is not configured`);
  const grouped = await withRetry(
    `grouped_bars:${opts.date}`,
    () => provider.fetchGroupedDailyBars(opts.date)
  );
  const groupedRows = grouped.bars;

  const symbolSet = new Set(opts.symbols);
  const existingRows: Array<{ symbol?: string | null }> = [];
  const eligibleSymbols = Array.from(symbolSet);
  for (let index = 0; index < eligibleSymbols.length; index += 400) {
    const { data, error } = await supa
      .from("price_bars")
      .select("symbol")
      .eq("date", opts.date)
      .in("symbol", eligibleSymbols.slice(index, index + 400))
      .eq("source", provider.id);
    if (error) throw error;
    existingRows.push(...(data ?? []));
  }
  const alreadyPresent = new Set(
    (existingRows ?? [])
      .map((r: { symbol?: string | null }) => String(r.symbol ?? "").toUpperCase())
      .filter(Boolean)
  );

  const upsertsBySymbol = new Map<string, {
    symbol: string;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source: string;
  }>();

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
    upsertsBySymbol.set(symbol, {
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

  const upserts = Array.from(upsertsBySymbol.values());

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
    await withRetry(`price_bars_upsert:${opts.date}:${i}`, async () => {
      const { error } = await supa.from("price_bars").upsert(chunk, {
        onConflict: "symbol,date",
      });
      if (error) throw error;
    });
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
    ingest_universe_slugs: INGEST_UNIVERSE_SLUGS,
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

  const { data: universes, error: universeErr } = await supa
    .from("universes")
    .select("id,slug")
    .in("slug", [...INGEST_UNIVERSE_SLUGS]);
  if (universeErr) throw new Error(universeErr.message);
  const universeIdBySlug = new Map<string, string>();
  for (const universe of universes ?? []) {
    if (universe?.id && universe?.slug) universeIdBySlug.set(String(universe.slug), String(universe.id));
  }
  const missingUniverses = INGEST_UNIVERSE_SLUGS.filter((slug) => !universeIdBySlug.has(slug));
  if (missingUniverses.length > 0) throw new Error(`Universe not found: ${missingUniverses.join(", ")}`);

  const symbolsByUniverse = new Map<string, string[]>();
  await Promise.all(
    INGEST_UNIVERSE_SLUGS.map(async (slug) => {
      const universeId = universeIdBySlug.get(slug)!;
      const symbols = await loadAllActiveUniverseSymbols({
        supabase: supa,
        universeId,
        universeSlug: slug,
      });
      if (symbols.length === 0) throw new Error(`Universe has no active members: ${slug}`);
      symbolsByUniverse.set(slug, symbols);
    })
  );
  const allUniverseSymbols = Array.from(new Set([...symbolsByUniverse.values()].flat()));
  const polygonApiKey = process.env.POLYGON_API_KEY;
  if (!polygonApiKey) throw new Error("Polygon is not configured: missing POLYGON_API_KEY");
  const activeUsCommonSymbols = Array.from(await fetchActiveUsCommonSymbols(polygonApiKey));
  if (activeUsCommonSymbols.length < 1_000) {
    throw new Error(
      `Polygon reference discovery returned only ${activeUsCommonSymbols.length} active US common stocks`
    );
  }
  // The daily refresh must discover the market independently of current
  // universe membership; otherwise new eligible stocks can never enter a cohort.
  const symbolsWithSpy = Array.from(new Set([...activeUsCommonSymbols, "SPY"]));

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

  const legacyCoreRun = await runFullStrategyScan({
    supabase: supa,
    universe_slug: CORE_UNIVERSE_SLUG,
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    scan_date_used: scanDate,
    total_members: symbolsByUniverse.get(CORE_UNIVERSE_SLUG)?.length ?? 0,
  });
  console.info("[daily-autopilot] scan:strategy_complete", {
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    universe_slug: CORE_UNIVERSE_SLUG,
    scan_date_used: scanDate,
    processed: legacyCoreRun.processed,
    scored: legacyCoreRun.scored,
    upserted: legacyCoreRun.upserted,
  });

  const trendRun = await runFullStrategyScan({
    supabase: supa,
    universe_slug: CORE_UNIVERSE_SLUG,
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    scan_date_used: scanDate,
    total_members: symbolsByUniverse.get(CORE_UNIVERSE_SLUG)?.length ?? 0,
  });
  console.info("[daily-autopilot] scan:strategy_complete", {
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    universe_slug: CORE_UNIVERSE_SLUG,
    scan_date_used: scanDate,
    processed: trendRun.processed,
    scored: trendRun.scored,
    upserted: trendRun.upserted,
  });

  const momentumRun = await runFullStrategyScan({
    supabase: supa,
    universe_slug: LEGACY_MOMENTUM_UNIVERSE_SLUG,
    strategy_version: MOMENTUM_STRATEGY_VERSION,
    scan_date_used: scanDate,
    total_members: symbolsByUniverse.get(LEGACY_MOMENTUM_UNIVERSE_SLUG)?.length ?? 0,
  });
  console.info("[daily-autopilot] scan:strategy_complete", {
    strategy_version: MOMENTUM_STRATEGY_VERSION,
    universe_slug: LEGACY_MOMENTUM_UNIVERSE_SLUG,
    scan_date_used: scanDate,
    processed: momentumRun.processed,
    scored: momentumRun.scored,
    upserted: momentumRun.upserted,
  });

  const finalizations: Record<string, any> = {};
  const primaryRuns = [
    { strategy_version: CORE_MOMENTUM_DEFAULT_VERSION, universe_slug: CORE_UNIVERSE_SLUG },
    { strategy_version: TREND_HOLD_DEFAULT_VERSION, universe_slug: CORE_UNIVERSE_SLUG },
    { strategy_version: MOMENTUM_STRATEGY_VERSION, universe_slug: LEGACY_MOMENTUM_UNIVERSE_SLUG },
  ];
  for (const run of primaryRuns) {
    const finalization = await finalizeSignals({
      supabase: supa,
      date: scanDate,
      universe_slug: run.universe_slug,
      strategy_version: run.strategy_version,
    });
    if (!finalization.ok) {
      throw new Error(
        `Finalization failed for ${run.strategy_version}@${run.universe_slug}: ${finalization.error ?? "unknown"}`
      );
    }
    finalizations[`${run.strategy_version}@${run.universe_slug}`] = finalization;
    // Preserve the legacy strategy-only lookup while consumers migrate to the
    // unambiguous strategy+universe context key.
    finalizations[run.strategy_version] ??= finalization;
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
    ingest_universe_slugs: INGEST_UNIVERSE_SLUGS,
    ingest_universe_counts: Object.fromEntries(
      INGEST_UNIVERSE_SLUGS.map((slug) => [slug, symbolsByUniverse.get(slug)?.length ?? 0])
    ),
    ingest_unique_symbols: allUniverseSymbols.length,
    market_discovery_symbols: activeUsCommonSymbols.length,
    bars_upserted: barsUpsertedTotal,
    ingest_attempts,
    ingest_selected_attempt: selectedAttempt,
    regime_state: regime.state ?? "FAVORABLE",
    regime_date_used: regime.regime_date_used,
    spy_regime_stale: regime.regime_stale,
    momentum: {
      strategy_version: MOMENTUM_STRATEGY_VERSION,
      universe_slug: LEGACY_MOMENTUM_UNIVERSE_SLUG,
      buys: Number(finalizations[`${MOMENTUM_STRATEGY_VERSION}@${LEGACY_MOMENTUM_UNIVERSE_SLUG}`]?.buy ?? 0),
      watch: Number(finalizations[`${MOMENTUM_STRATEGY_VERSION}@${LEGACY_MOMENTUM_UNIVERSE_SLUG}`]?.watch ?? 0),
    },
    trend: {
      strategy_version: TREND_HOLD_DEFAULT_VERSION,
      universe_slug: CORE_UNIVERSE_SLUG,
      buys: Number(finalizations[`${TREND_HOLD_DEFAULT_VERSION}@${CORE_UNIVERSE_SLUG}`]?.buy ?? 0),
      watch: Number(finalizations[`${TREND_HOLD_DEFAULT_VERSION}@${CORE_UNIVERSE_SLUG}`]?.watch ?? 0),
    },
    legacy_core_momentum: {
      strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
      universe_slug: CORE_UNIVERSE_SLUG,
      buys: Number(finalizations[`${CORE_MOMENTUM_DEFAULT_VERSION}@${CORE_UNIVERSE_SLUG}`]?.buy ?? 0),
      watch: Number(finalizations[`${CORE_MOMENTUM_DEFAULT_VERSION}@${CORE_UNIVERSE_SLUG}`]?.watch ?? 0),
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
      market_discovery_symbols: result.market_discovery_symbols,
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
