import type { SupabaseClient } from "@supabase/supabase-js";
import { rebuildCanonicalUniverses } from "@/lib/canonical_universes";
import { getMarketDataProvider } from "@/lib/market-data";
import {
  latestCompletedUsTradingDay,
  previousUsMarketTradingDay,
  shiftIsoDate,
} from "@/lib/market-calendar";
import { momentumBaselineManifest } from "@/lib/strategy/momentum_parameters";
import { LEGACY_MOMENTUM_UNIVERSE_SLUG } from "@/lib/strategy_universe";
import { fetchActiveUsCommonSymbols } from "@/lib/universe_reference";

export const MARKET_COVERAGE_STATUS_KEY = "market_coverage_bootstrap_v1";
export const MARKET_COVERAGE_VERSION = "polygon_us_common_coverage_v1";

type CoveragePhase =
  | "initialized"
  | "discovering"
  | "discovery_complete"
  | "hydrating_history"
  | "history_complete"
  | "complete";

type CoverageFailure = {
  symbol: string;
  error: string;
};

export type MarketCoverageState = {
  version: typeof MARKET_COVERAGE_VERSION;
  phase: CoveragePhase;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  latest_completed_date: string;
  discovery_dates: string[];
  discovery_cursor: number;
  discovery_rows_written: number;
  active_symbols: string[];
  history_symbols: string[];
  history_cursor: number;
  history_rows_written: number;
  history_failures: CoverageFailure[];
  canonical_rebuild: Record<string, unknown> | null;
};

type CoverageClient = SupabaseClient;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDatabaseRetry<T>(label: string, operation: () => PromiseLike<T>, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after 25000ms`)), 25_000);
      });
      return await Promise.race([Promise.resolve(operation()), timeoutPromise]);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.warn("[market-coverage] database_retry", {
        label,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(500 * 2 ** (attempt - 1));
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  throw lastError;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function historyFromDate(scanDate: string) {
  return shiftIsoDate(scanDate, -820);
}

function buildTradingDates(latestDate: string, count: number) {
  const dates = [latestDate];
  let cursor = latestDate;
  while (dates.length < count) {
    cursor = previousUsMarketTradingDay(cursor);
    dates.push(cursor);
  }
  return dates.reverse();
}

function normalizeSymbol(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

async function readState(supabase: CoverageClient) {
  const { data, error } = await supabase
    .from("system_status")
    .select("value,updated_at")
    .eq("key", MARKET_COVERAGE_STATUS_KEY)
    .maybeSingle();
  if (error) throw new Error(`Coverage status read failed: ${error.message}`);
  if (!data?.value || typeof data.value !== "object") return null;
  return data.value as MarketCoverageState;
}

async function writeState(supabase: CoverageClient, state: MarketCoverageState) {
  const next = { ...state, updated_at: nowIso() };
  const { error } = await withDatabaseRetry("Coverage status write", () =>
    supabase.from("system_status").upsert(
      {
        key: MARKET_COVERAGE_STATUS_KEY,
        value: next,
        updated_at: next.updated_at,
      },
      { onConflict: "key" }
    )
  );
  if (error) throw new Error(`Coverage status write failed: ${error.message}`);
  return next;
}

function requireState(state: MarketCoverageState | null) {
  if (!state || state.version !== MARKET_COVERAGE_VERSION) {
    throw new Error("Market coverage is not initialized. Start a new coverage run first.");
  }
  return state;
}

function publicState(state: MarketCoverageState | null) {
  if (!state) return null;
  return {
    version: state.version,
    phase: state.phase,
    started_at: state.started_at,
    updated_at: state.updated_at,
    completed_at: state.completed_at,
    latest_completed_date: state.latest_completed_date,
    active_symbols: state.active_symbols.length,
    discovery: {
      completed: state.discovery_cursor,
      total: state.discovery_dates.length,
      rows_written: state.discovery_rows_written,
      next_date: state.discovery_dates[state.discovery_cursor] ?? null,
    },
    history: {
      completed: state.history_cursor,
      total: state.history_symbols.length,
      rows_written: state.history_rows_written,
      failures: state.history_failures.length,
      next_symbol: state.history_symbols[state.history_cursor] ?? null,
    },
    canonical_rebuild: state.canonical_rebuild,
  };
}

async function latestBarCoverage(supabase: CoverageClient, state: MarketCoverageState | null) {
  const expectedDate = state?.latest_completed_date ?? latestCompletedUsTradingDay();
  const { count, error } = await supabase
    .from("price_bars")
    .select("symbol", { count: "exact", head: true })
    .eq("date", expectedDate)
    .eq("source", "polygon");
  if (error) throw new Error(`Latest bar coverage failed: ${error.message}`);

  const { data: broadUniverse, error: universeError } = await supabase
    .from("universes")
    .select("id")
    .eq("slug", LEGACY_MOMENTUM_UNIVERSE_SLUG)
    .maybeSingle();
  if (universeError) throw new Error(`Broad universe lookup failed: ${universeError.message}`);

  let broadMembers = 0;
  if (broadUniverse?.id) {
    const { count: memberCount, error: memberError } = await supabase
      .from("universe_members")
      .select("symbol", { count: "exact", head: true })
      .eq("universe_id", broadUniverse.id)
      .eq("active", true);
    if (memberError) throw new Error(`Broad universe count failed: ${memberError.message}`);
    broadMembers = memberCount ?? 0;
  }

  return {
    expected_date: expectedDate,
    polygon_rows_on_expected_date: count ?? 0,
    active_us_common_reference_count: state?.active_symbols.length ?? null,
    broad_liquid_us_members: broadMembers,
  };
}

export async function marketCoverageStatus(supabase: CoverageClient) {
  const state = await readState(supabase);
  return {
    ok: true,
    state: publicState(state),
    coverage: await latestBarCoverage(supabase, state),
    calibration: momentumBaselineManifest(),
  };
}

export async function initializeMarketCoverage(opts: {
  supabase: CoverageClient;
  polygonApiKey: string;
  discoverySessions?: number;
}) {
  const startedAt = nowIso();
  const discoverySessions = clamp(opts.discoverySessions, 20, 45, 30);
  const activeSymbols = Array.from(await fetchActiveUsCommonSymbols(opts.polygonApiKey)).sort();
  if (activeSymbols.length < 1_000) {
    throw new Error(`Polygon returned only ${activeSymbols.length} active US common stocks; refusing partial discovery.`);
  }
  const latestDate = latestCompletedUsTradingDay();
  const state = await writeState(opts.supabase, {
    version: MARKET_COVERAGE_VERSION,
    phase: "initialized",
    started_at: startedAt,
    updated_at: startedAt,
    completed_at: null,
    latest_completed_date: latestDate,
    discovery_dates: buildTradingDates(latestDate, discoverySessions),
    discovery_cursor: 0,
    discovery_rows_written: 0,
    active_symbols: activeSymbols,
    history_symbols: [],
    history_cursor: 0,
    history_rows_written: 0,
    history_failures: [],
    canonical_rebuild: null,
  });
  return { ok: true, action: "initialize", state: publicState(state) };
}

export async function runDiscoveryBatch(supabase: CoverageClient) {
  const state = requireState(await readState(supabase));
  if (state.discovery_cursor >= state.discovery_dates.length) {
    const completed = await writeState(supabase, { ...state, phase: "discovery_complete" });
    return { ok: true, action: "discovery_batch", done: true, rows_written: 0, state: publicState(completed) };
  }

  const provider = getMarketDataProvider();
  if (!provider.configured) throw new Error(`${provider.label} market data is not configured`);
  const date = state.discovery_dates[state.discovery_cursor];
  const activeSet = new Set(state.active_symbols);
  activeSet.add("SPY");
  const grouped = await provider.fetchGroupedDailyBars(date);
  const rowsBySymbol = new Map<string, Record<string, unknown>>();
  for (const bar of grouped.bars) {
    if (!activeSet.has(bar.symbol)) continue;
    rowsBySymbol.set(bar.symbol, { ...bar, source: provider.id });
  }
  const rows = Array.from(rowsBySymbol.values());
  if (rows.length < 500) {
    throw new Error(`Grouped bars for ${date} returned only ${rows.length} eligible rows; batch was not finalized.`);
  }

  let written = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const { error } = await withDatabaseRetry(`Grouped bar upsert ${date}`, () =>
      supabase.from("price_bars").upsert(chunk, { onConflict: "symbol,date" })
    );
    if (error) throw new Error(`Grouped bar upsert failed for ${date}: ${error.message}`);
    written += chunk.length;
  }

  const cursor = state.discovery_cursor + 1;
  const next = await writeState(supabase, {
    ...state,
    phase: cursor >= state.discovery_dates.length ? "discovery_complete" : "discovering",
    discovery_cursor: cursor,
    discovery_rows_written: state.discovery_rows_written + written,
  });
  console.info("[market-coverage] discovery_batch", {
    date,
    grouped_rows: grouped.bars.length,
    eligible_rows: rows.length,
    completed: cursor,
    total: state.discovery_dates.length,
  });
  return {
    ok: true,
    action: "discovery_batch",
    date,
    grouped_rows: grouped.bars.length,
    rows_written: written,
    done: cursor >= state.discovery_dates.length,
    state: publicState(next),
  };
}

async function loadUniverseSymbols(supabase: CoverageClient, slug: string) {
  const { data: universe, error: universeError } = await supabase
    .from("universes")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (universeError) throw new Error(`Universe lookup failed: ${universeError.message}`);
  if (!universe?.id) throw new Error(`Universe not found: ${slug}`);

  const symbols: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("universe_members")
      .select("symbol")
      .eq("universe_id", universe.id)
      .eq("active", true)
      .order("symbol", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Universe member load failed: ${error.message}`);
    const page = (data ?? []).map((row) => normalizeSymbol(row.symbol)).filter(Boolean);
    symbols.push(...page);
    if (page.length < 1000) break;
  }
  return Array.from(new Set(symbols));
}

export async function rebuildAndPrepareHistory(opts: {
  supabase: CoverageClient;
  polygonApiKey: string;
}) {
  const state = requireState(await readState(opts.supabase));
  if (state.discovery_cursor < state.discovery_dates.length) {
    throw new Error(`Discovery is incomplete (${state.discovery_cursor}/${state.discovery_dates.length}).`);
  }
  const canonical = await rebuildCanonicalUniverses({
    supabase: opts.supabase,
    polygonApiKey: opts.polygonApiKey,
    scanDate: state.latest_completed_date,
    marketCapConcurrency: 24,
  });
  const historySymbols = await loadUniverseSymbols(opts.supabase, LEGACY_MOMENTUM_UNIVERSE_SLUG);
  if (!historySymbols.includes("SPY")) historySymbols.push("SPY");
  historySymbols.sort();
  const next = await writeState(opts.supabase, {
    ...state,
    phase: "hydrating_history",
    history_symbols: historySymbols,
    history_cursor: 0,
    history_rows_written: 0,
    history_failures: [],
    canonical_rebuild: canonical as unknown as Record<string, unknown>,
  });
  return { ok: true, action: "rebuild", state: publicState(next) };
}

export async function runHistoryBatch(supabase: CoverageClient, requestedBatchSize?: number) {
  const state = requireState(await readState(supabase));
  if (state.history_symbols.length === 0) throw new Error("Canonical rebuild has not prepared history symbols.");
  if (state.history_cursor >= state.history_symbols.length) {
    const completed = await writeState(supabase, { ...state, phase: "history_complete" });
    return { ok: true, action: "history_batch", done: true, rows_written: 0, state: publicState(completed) };
  }

  const provider = getMarketDataProvider();
  if (!provider.configured) throw new Error(`${provider.label} market data is not configured`);
  const batchSize = clamp(requestedBatchSize, 1, 15, 10);
  const symbols = state.history_symbols.slice(state.history_cursor, state.history_cursor + batchSize);
  const from = historyFromDate(state.latest_completed_date);
  const settled = await Promise.allSettled(
    symbols.map((symbol) => provider.fetchDailyBars(symbol, from, state.latest_completed_date))
  );

  const rows: Array<Record<string, unknown>> = [];
  const failures: CoverageFailure[] = [];
  settled.forEach((result, index) => {
    const symbol = symbols[index];
    if (result.status === "rejected") {
      failures.push({
        symbol,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      return;
    }
    for (const bar of result.value.bars) rows.push({ ...bar, source: provider.id });
  });

  let written = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const { error } = await withDatabaseRetry("History upsert", () =>
      supabase.from("price_bars").upsert(chunk, { onConflict: "symbol,date" })
    );
    if (error) throw new Error(`History upsert failed: ${error.message}`);
    written += chunk.length;
  }

  const cursor = state.history_cursor + symbols.length;
  const next = await writeState(supabase, {
    ...state,
    phase: cursor >= state.history_symbols.length ? "history_complete" : "hydrating_history",
    history_cursor: cursor,
    history_rows_written: state.history_rows_written + written,
    history_failures: [...state.history_failures, ...failures].slice(-100),
  });
  console.info("[market-coverage] history_batch", {
    symbols,
    bars_written: written,
    failures: failures.length,
    completed: cursor,
    total: state.history_symbols.length,
  });
  return {
    ok: true,
    action: "history_batch",
    symbols,
    rows_written: written,
    failures,
    done: cursor >= state.history_symbols.length,
    state: publicState(next),
  };
}

export async function finalizeMarketCoverage(supabase: CoverageClient) {
  const state = requireState(await readState(supabase));
  if (state.history_cursor < state.history_symbols.length) {
    throw new Error(`History hydration is incomplete (${state.history_cursor}/${state.history_symbols.length}).`);
  }
  const completed = await writeState(supabase, {
    ...state,
    phase: "complete",
    completed_at: nowIso(),
  });
  return {
    ok: true,
    action: "finalize",
    state: publicState(completed),
    coverage: await latestBarCoverage(supabase, completed),
    calibration: momentumBaselineManifest(),
  };
}
