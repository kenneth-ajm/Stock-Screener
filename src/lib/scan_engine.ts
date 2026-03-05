import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
  evaluateCoreMomentumSwing,
  type RegimeState,
  type RuleEvaluation,
} from "@/lib/strategy/coreMomentumSwing";
import {
  TREND_HOLD_DEFAULT_VERSION,
  evaluateTrendHold,
} from "@/lib/strategy/trendHold";
import { getLCTD } from "@/lib/scan_date";
import { finalizeSignals } from "@/lib/finalize_signals";

export type ScanEngineClient = SupabaseClient<any, any, any> | any;

export type ResolveScanDateResult = {
  ok: boolean;
  scan_date_used: string | null;
  lctd_source: "spy_max_date" | "global_max_date" | "none";
  error?: string;
};

export type LoadRegimeResult = {
  regime_state: RegimeState;
  regime_stale: boolean;
  regime_date_used: string | null;
  regime_source: "exact" | "latest" | "default";
};

type ScanRowPayload = {
  date: string;
  universe_slug: string;
  strategy_version: string;
  symbol: string;
  signal: RuleEvaluation["signal"];
  confidence: number;
  rank_score: number;
  rank: number | null;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  reason_summary: string;
  reason_json: RuleEvaluation["reason_json"];
  updated_at: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function makeScanEngineClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars for scan engine");
  return createClient(url, key, { auth: { persistSession: false } }) as ScanEngineClient;
}

export async function resolveScanDate(opts: {
  supabase: ScanEngineClient;
  requestedScanDate?: string | null;
}): Promise<ResolveScanDateResult> {
  const resolved = await getLCTD(opts.supabase);
  return {
    ok: resolved.ok,
    scan_date_used: resolved.scan_date,
    lctd_source: resolved.lctd_source,
    error: resolved.error ?? undefined,
  };
}

export async function loadUniverseSymbols(opts: {
  supabase: ScanEngineClient;
  universe_slug: string;
  offset?: number;
  limit?: number;
}) {
  const supa = opts.supabase as any;
  const offset = Number.isFinite(opts.offset as number) ? Number(opts.offset) : 0;
  const limit = Number.isFinite(opts.limit as number) ? Number(opts.limit) : 200;

  const { data: universe, error: uErr } = await supa
    .from("universes")
    .select("id,slug")
    .eq("slug", opts.universe_slug)
    .single();
  if (uErr || !universe?.id) {
    return {
      ok: false,
      symbols: [] as string[],
      error: `Universe not found: ${opts.universe_slug}`,
    };
  }

  const { data: members, error: mErr } = await supa
    .from("universe_members")
    .select("symbol")
    .eq("universe_id", universe.id)
    .eq("active", true)
    .order("symbol", { ascending: true })
    .range(offset, offset + limit - 1);

  if (mErr) {
    return {
      ok: false,
      symbols: [] as string[],
      error: mErr.message,
    };
  }

  const symbols = (members ?? [])
    .map((m: { symbol?: string | null }) => String(m.symbol ?? "").toUpperCase())
    .filter(Boolean);

  return { ok: true, symbols, error: null };
}

export async function loadRegimeState(opts: {
  supabase: ScanEngineClient;
  scan_date_used: string;
}): Promise<LoadRegimeResult> {
  const supa = opts.supabase as any;
  try {
    const { data: exactData, error: exactErr } = await supa
      .from("market_regime")
      .select("date,state")
      .eq("symbol", "SPY")
      .eq("date", opts.scan_date_used)
      .limit(1);
    if (!exactErr && exactData?.[0]?.state) {
      return {
        regime_state: (exactData[0].state as RegimeState) ?? "FAVORABLE",
        regime_stale: false,
        regime_date_used: String(exactData[0].date),
        regime_source: "exact",
      };
    }

    const { data: latestData, error: latestErr } = await supa
      .from("market_regime")
      .select("date,state")
      .eq("symbol", "SPY")
      .order("date", { ascending: false })
      .limit(1);
    if (!latestErr && latestData?.[0]?.state) {
      return {
        regime_state: (latestData[0].state as RegimeState) ?? "FAVORABLE",
        regime_stale: String(latestData[0].date) !== opts.scan_date_used,
        regime_date_used: String(latestData[0].date),
        regime_source: "latest",
      };
    }

    return {
      regime_state: "FAVORABLE",
      regime_stale: true,
      regime_date_used: null,
      regime_source: "default",
    };
  } catch {
    return {
      regime_state: "FAVORABLE",
      regime_stale: true,
      regime_date_used: null,
      regime_source: "default",
    };
  }
}

function computeRankScore(strategyVersion: string, confidence: number, reasonJson: any) {
  const indicators = reasonJson?.indicators && typeof reasonJson.indicators === "object" ? reasonJson.indicators : {};
  const confidenceNorm = clamp((toNum(confidence) ?? 50) / 100, 0, 1);

  if (strategyVersion === TREND_HOLD_DEFAULT_VERSION) {
    const rsOut = toNum(indicators.rsOutperformance ?? indicators.rsProxy);
    const nearHighPct = toNum(indicators.nearHighPct);
    const sma200Slope = toNum(indicators.sma200Slope);
    const adv = toNum(indicators.avgDollarVolume20);
    const rsScore = rsOut == null ? 0.5 : clamp((rsOut + 0.05) / 0.2, 0, 1);
    const nearHighScore = nearHighPct == null ? 0.5 : clamp((nearHighPct - 0.7) / 0.3, 0, 1);
    const slopeScore = sma200Slope == null ? 0.5 : clamp((sma200Slope + 0.02) / 0.08, 0, 1);
    const liqScore = adv == null ? 0.5 : clamp((adv - 5_000_000) / 45_000_000, 0, 1);
    return round2(rsScore * 35 + nearHighScore * 25 + slopeScore * 20 + liqScore * 20);
  }

  const volumeSpike = toNum(indicators.volumeSpike);
  const rsi14 = toNum(indicators.rsi14);
  const distInAtr = toNum(indicators.distInAtr);
  const volumeScore = volumeSpike == null ? 0.5 : clamp((volumeSpike - 1) / 1.5, 0, 1);
  const rsiScore = rsi14 == null ? 0.5 : 1 - clamp(Math.abs(rsi14 - 55) / 20, 0, 1);
  const extensionScore = distInAtr == null ? 0.5 : 1 - clamp(distInAtr / 2, 0, 1);
  return round2(confidenceNorm * 50 + volumeScore * 15 + rsiScore * 15 + extensionScore * 20);
}

export function scoreSymbol(opts: {
  symbol: string;
  bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
  regime_state: RegimeState;
  strategy_version: string;
  spy252Return?: number | null;
}) {
  const strategyVersion = opts.strategy_version || CORE_MOMENTUM_DEFAULT_VERSION;
  const computed =
    strategyVersion === TREND_HOLD_DEFAULT_VERSION
      ? evaluateTrendHold({
          bars: opts.bars,
          regime: opts.regime_state,
          spy252Return: opts.spy252Return ?? null,
        })
      : evaluateCoreMomentumSwing({
          bars: opts.bars,
          regime: opts.regime_state,
        });

  if (!computed) return null;

  return {
    signal: computed.signal,
    confidence: computed.confidence,
    entry: computed.entry,
    stop: computed.stop,
    tp1: computed.tp1,
    tp2: computed.tp2,
    reason_summary: computed.reason_summary,
    reason_json: computed.reason_json,
  };
}

export async function upsertRawDailyScans(opts: {
  supabase: ScanEngineClient;
  rows: ScanRowPayload[];
}) {
  const supa = opts.supabase as any;
  if (!opts.rows.length) return { ok: true, upserted: 0 };
  const { data, error } = await supa
    .from("daily_scans")
    .upsert(opts.rows as any[], { onConflict: "date,universe_slug,symbol,strategy_version" })
    .select("id");
  if (error) return { ok: false, upserted: 0, error: error.message };
  return { ok: true, upserted: data?.length ?? 0 };
}

export async function runScanPipeline(opts: {
  supabase: ScanEngineClient;
  universe_slug?: string;
  strategy_version?: string;
  scan_date?: string;
  offset?: number;
  limit?: number;
  finalize?: boolean;
}) {
  const supa = opts.supabase as any;
  const universe_slug = opts.universe_slug ?? CORE_MOMENTUM_DEFAULT_UNIVERSE;
  const strategy_version = opts.strategy_version ?? CORE_MOMENTUM_DEFAULT_VERSION;
  const startedAt = Date.now();

  const dateResolved = await resolveScanDate({ supabase: supa });
  if (!dateResolved.ok || !dateResolved.scan_date_used) {
    return {
      ok: false,
      error: dateResolved.error ?? "Unable to resolve scan date",
      scan_date_used: null,
      lctd_source: dateResolved.lctd_source,
    };
  }
  const scanDate = dateResolved.scan_date_used;

  // Guardrail: remove impossible future scan rows for this universe/strategy.
  await supa
    .from("daily_scans")
    .delete()
    .eq("universe_slug", universe_slug)
    .eq("strategy_version", strategy_version)
    .gt("date", scanDate);

  const symbolsResult = await loadUniverseSymbols({
    supabase: supa,
    universe_slug,
    offset: opts.offset ?? 0,
    limit: opts.limit ?? 200,
  });
  if (!symbolsResult.ok) {
    return {
      ok: false,
      error: symbolsResult.error ?? "Unable to load universe symbols",
      scan_date_used: scanDate,
      lctd_source: dateResolved.lctd_source,
    };
  }
  const symbols = symbolsResult.symbols;
  if (!symbols.length) {
    return {
      ok: true,
      universe_slug,
      strategy_version,
      scan_date_used: scanDate,
      lctd_source: dateResolved.lctd_source,
      regime_state: "FAVORABLE" as RegimeState,
      regime_stale: true,
      processed: 0,
      scored: 0,
      upserted: 0,
      duration_ms: Date.now() - startedAt,
      note: "No symbols in selected universe slice",
    };
  }

  const regime = await loadRegimeState({ supabase: supa, scan_date_used: scanDate });
  let spy252Return: number | null = null;
  if (strategy_version === TREND_HOLD_DEFAULT_VERSION) {
    const { data: spyBars } = await supa
      .from("price_bars")
      .select("date,close")
      .eq("symbol", "SPY")
      .eq("source", "polygon")
      .lte("date", scanDate)
      .order("date", { ascending: true })
      .limit(260);
    if (spyBars && spyBars.length >= 252) {
      const latest = Number(spyBars[spyBars.length - 1]?.close);
      const start = Number(spyBars[spyBars.length - 252]?.close);
      if (Number.isFinite(latest) && Number.isFinite(start) && start > 0) {
        spy252Return = latest / start - 1;
      }
    }
  }

  const rows: ScanRowPayload[] = [];
  let processed = 0;
  let scored = 0;
  for (const symbol of symbols) {
    processed += 1;
    const { data: bars, error: bErr } = await supa
      .from("price_bars")
      .select("date,open,high,low,close,volume")
      .eq("symbol", symbol)
      .eq("source", "polygon")
      .lte("date", scanDate)
      .order("date", { ascending: true })
      .limit(300);
    if (bErr || !bars || bars.length < 260) continue;

    const scoredRow = scoreSymbol({
      symbol,
      bars: bars.map((bar: any) => ({
        date: String(bar.date),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume),
      })),
      regime_state: regime.regime_state,
      strategy_version,
      spy252Return,
    });
    if (!scoredRow) continue;
    scored += 1;

    const reasonJson = scoredRow.reason_json && typeof scoredRow.reason_json === "object" ? (scoredRow.reason_json as any) : {};
    const rankScore = computeRankScore(strategy_version, scoredRow.confidence, reasonJson);
    rows.push({
      date: scanDate,
      universe_slug,
      strategy_version,
      symbol,
      signal: scoredRow.signal,
      confidence: scoredRow.confidence,
      rank_score: rankScore,
      rank: null,
      entry: scoredRow.entry,
      stop: scoredRow.stop,
      tp1: scoredRow.tp1,
      tp2: scoredRow.tp2,
      reason_summary: scoredRow.reason_summary,
      reason_json: {
        ...reasonJson,
        rank_score: rankScore,
      } as RuleEvaluation["reason_json"],
      updated_at: new Date().toISOString(),
    });
  }

  const futureRows = rows.filter((row) => String(row.date) > scanDate);
  if (futureRows.length > 0) {
    console.error("scan_engine refusing future-dated rows", {
      scanDate,
      count: futureRows.length,
      symbols: futureRows.slice(0, 10).map((r) => r.symbol),
    });
    return {
      ok: false,
      error: `Refusing to write ${futureRows.length} rows after LCTD ${scanDate}`,
      scan_date_used: scanDate,
      lctd_source: dateResolved.lctd_source,
      processed,
      scored,
    };
  }

  const upsertRaw = await upsertRawDailyScans({ supabase: supa, rows });
  if (!upsertRaw.ok) {
    return {
      ok: false,
      error: upsertRaw.error ?? "Raw upsert failed",
      scan_date_used: scanDate,
      lctd_source: dateResolved.lctd_source,
      processed,
      scored,
    };
  }

  let finalization: unknown = null;
  const shouldFinalize = opts.finalize ?? true;
  if (shouldFinalize) {
    finalization = await finalizeSignals({
      supabase: supa,
      date: scanDate,
      universe_slug,
      strategy_version,
    });
  }

  return {
    ok: true,
    universe_slug,
    strategy_version,
    scan_date_used: scanDate,
    lctd_source: dateResolved.lctd_source,
    regime_state: regime.regime_state,
    regime_stale: regime.regime_stale,
    regime_date_used: regime.regime_date_used,
    offset: Number.isFinite(opts.offset as number) ? Number(opts.offset) : 0,
    limit: Number.isFinite(opts.limit as number) ? Number(opts.limit) : 200,
    processed,
    scored,
    upserted: upsertRaw.upserted,
    finalization,
    duration_ms: Date.now() - startedAt,
  };
}
