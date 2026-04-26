import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildTechnicalTargets } from "@/lib/target_engine";

export const dynamic = "force-dynamic";

type TacticalSignal = "BUY" | "WATCH" | "AVOID";
type TacticalSetupType = "Q Breakout" | "Q EP Daily" | "Momentum Watch" | "Defensive";
type TacticalTimingState = "BUY_READY" | "NEAR_TRIGGER" | "TOO_EXTENDED" | "DEFENSIVE";

type TacticalMomentumRow = {
  symbol: string;
  name: string;
  group: string;
  setup_type: TacticalSetupType;
  timing_state: TacticalTimingState;
  timing_label: string;
  ranking_score: number | null;
  current_price: number | null;
  breakout_level: number | null;
  distance_to_breakout_pct: number | null;
  relative_volume: number | null;
  day_change_pct: number | null;
  range_10d_pct: number | null;
  stock_above_sma20: boolean | null;
  stock_above_sma50: boolean | null;
  stock_above_sma200: boolean | null;
  market_spy_above_sma200: boolean;
  signal: TacticalSignal;
  entry_price: number | null;
  stop_price: number | null;
  tp1_price: number | null;
  tp2_price: number | null;
  target_model: string | null;
  tp1_reason: string | null;
  tp2_reason: string | null;
  reason_summary: string;
  source_date: string | null;
  bars_count: number;
};

type TacticalFreshnessState = "current" | "mixed" | "stale";

type TacticalMomentumScanItem = {
  symbol: string;
  name: string;
  group: string;
};

type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round2(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function mapRowToPriceBar(row: any): PriceBar | null {
  const date = typeof row?.date === "string" ? String(row.date) : null;
  const open = toNumber(row?.open);
  const high = toNumber(row?.high);
  const low = toNumber(row?.low);
  const close = toNumber(row?.close);
  const volume = toNumber(row?.volume);
  if (!date || open == null || high == null || low == null || close == null || volume == null) return null;
  return { date, open, high, low, close, volume };
}

async function fetchBarsForSymbol(supabase: any, symbol: string, limit = 260) {
  const { data, error } = await supabase
    .from("price_bars")
    .select("date,open,high,low,close,volume")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .map(mapRowToPriceBar)
    .filter((row): row is PriceBar => Boolean(row));
}

async function fetchBarsBySymbol(supabase: any, symbols: string[], limit = 260) {
  const results = new Map<string, PriceBar[]>();
  const uniqueSymbols = Array.from(new Set(symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean)));
  for (let i = 0; i < uniqueSymbols.length; i += 25) {
    const chunk = uniqueSymbols.slice(i, i + 25);
    const chunkResults = await Promise.all(
      chunk.map(async (symbol) => {
        const bars = await fetchBarsForSymbol(supabase, symbol, limit);
        return [symbol, bars] as const;
      })
    );
    for (const [symbol, bars] of chunkResults) {
      results.set(symbol, bars);
    }
  }
  return results;
}

async function loadMarketScanSymbols(supabase: any, opts: { scanDate: string; maxSymbols?: number }) {
  const universeSlugs = ["liquid_2000", "midcap_1000", "growth_1500", "core_800"];
  const maxSymbols = Math.max(100, Math.min(1200, Number(opts.maxSymbols ?? 500)));
  const { data: universes, error: universeErr } = await supabase
    .from("universes")
    .select("id,slug")
    .in("slug", universeSlugs);
  if (universeErr) throw universeErr;

  const universeIdToSlug = new Map<string, string>();
  for (const universe of universes ?? []) {
    if ((universe as any)?.id && (universe as any)?.slug) {
      universeIdToSlug.set(String((universe as any).id), String((universe as any).slug));
    }
  }

  const universeIds = [...universeIdToSlug.keys()];
  const symbolToUniverses = new Map<string, Set<string>>();
  for (const universeId of universeIds) {
    const { data: members, error: memberErr } = await supabase
      .from("universe_members")
      .select("symbol,universe_id")
      .eq("universe_id", universeId)
      .eq("active", true)
      .limit(2500);
    if (memberErr) throw memberErr;
    const slug = universeIdToSlug.get(universeId) ?? "market";
    for (const member of members ?? []) {
      const symbol = String((member as any)?.symbol ?? "").trim().toUpperCase();
      if (!symbol || symbol.includes(".")) continue;
      if (!symbolToUniverses.has(symbol)) symbolToUniverses.set(symbol, new Set());
      symbolToUniverses.get(symbol)!.add(slug);
    }
  }

  let symbols = [...symbolToUniverses.keys()];
  if (!symbols.length) {
    const { data: latestBars, error: latestErr } = await supabase
      .from("price_bars")
      .select("symbol,close,volume")
      .eq("date", opts.scanDate)
      .eq("source", "polygon")
      .limit(5000);
    if (latestErr) throw latestErr;
    symbols = (latestBars ?? [])
      .map((row: any) => String(row?.symbol ?? "").trim().toUpperCase())
      .filter((symbol: string) => symbol && !symbol.includes("."));
  }

  const liquidityRows: Array<{ symbol: string; close: number; volume: number; dollar: number }> = [];
  for (let i = 0; i < symbols.length; i += 500) {
    const chunk = symbols.slice(i, i + 500);
    const { data: latestBars, error: latestErr } = await supabase
      .from("price_bars")
      .select("symbol,close,volume")
      .in("symbol", chunk)
      .eq("date", opts.scanDate)
      .eq("source", "polygon")
      .limit(500);
    if (latestErr) throw latestErr;
    for (const row of latestBars ?? []) {
      const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
      const close = Number((row as any)?.close);
      const volume = Number((row as any)?.volume);
      const dollar = Number.isFinite(close) && close > 0 && Number.isFinite(volume) && volume > 0 ? close * volume : 0;
      if (!symbol || close < 2 || dollar < 1_000_000) continue;
      liquidityRows.push({ symbol, close, volume, dollar });
    }
  }

  const selected = liquidityRows
    .sort((a, b) => b.dollar - a.dollar)
    .slice(0, maxSymbols)
    .map((row) => row.symbol);

  return {
    symbols: selected,
    items: selected.map((symbol) => ({
      symbol,
      name: symbol,
      group: symbolToUniverses.get(symbol)?.has("midcap_1000")
        ? "Midcap Market"
        : symbolToUniverses.get(symbol)?.has("growth_1500")
          ? "Growth Market"
          : symbolToUniverses.get(symbol)?.has("liquid_2000")
            ? "Liquid Market"
            : "Core Market",
    })),
    source_universes: universeSlugs.filter((slug) => [...symbolToUniverses.values()].some((set) => set.has(slug))),
    candidate_symbols_count: symbols.length,
    scanned_symbols_count: selected.length,
  };
}

function evaluateRow(item: TacticalMomentumScanItem, barsDesc: PriceBar[], spyHealthy: boolean): TacticalMomentumRow {
  if (!Array.isArray(barsDesc) || barsDesc.length < 60) {
    return {
      symbol: item.symbol,
      name: item.name,
      group: item.group,
      setup_type: "Defensive",
      timing_state: "DEFENSIVE",
      timing_label: "Defensive",
      ranking_score: 10,
      current_price: null,
      breakout_level: null,
      distance_to_breakout_pct: null,
      relative_volume: null,
      day_change_pct: null,
      range_10d_pct: null,
      stock_above_sma20: null,
      stock_above_sma50: null,
      stock_above_sma200: null,
      market_spy_above_sma200: spyHealthy,
      signal: "AVOID",
      entry_price: null,
      stop_price: null,
      tp1_price: null,
      tp2_price: null,
      target_model: null,
      tp1_reason: null,
      tp2_reason: null,
      reason_summary: "Insufficient price history for tactical momentum evaluation.",
      source_date: barsDesc?.[0]?.date ?? null,
      bars_count: barsDesc.length,
    };
  }

  const asc = [...barsDesc].reverse();
  const closes = asc.map((bar) => bar.close);
  const latest = barsDesc[0];
  const previous = barsDesc[1] ?? null;
  const latest20 = barsDesc.slice(0, 20);
  const prior20 = barsDesc.slice(1, 21);
  const latest10 = barsDesc.slice(0, 10);
  const low10 = latest10.length > 0 ? Math.min(...latest10.map((bar) => bar.low)) : latest.low;
  const high20 = latest20.length > 0 ? Math.max(...latest20.map((bar) => bar.high)) : latest.high;
  const prior20High = prior20.length > 0 ? Math.max(...prior20.map((bar) => bar.high)) : high20;
  const sma20Value = sma(closes, 20);
  const sma50Value = sma(closes, 50);
  const sma200Value = sma(closes, 200);
  const avgVolume20 = average(asc.slice(-20).map((bar) => bar.volume));
  const relativeVolume = avgVolume20 > 0 ? latest.volume / avgVolume20 : null;
  const dayChangePct = previous && previous.close > 0 ? ((latest.close - previous.close) / previous.close) * 100 : null;
  const range10Pct = latest.close > 0 ? ((Math.max(...latest10.map((bar) => bar.high)) - Math.min(...latest10.map((bar) => bar.low))) / latest.close) * 100 : null;
  const distanceToBreakoutPct = prior20High > 0 ? ((prior20High - latest.close) / prior20High) * 100 : null;
  const stockAboveSma20 = sma20Value != null ? latest.close > sma20Value : null;
  const stockAboveSma50 = sma50Value != null ? latest.close > sma50Value : null;
  const stockAboveSma200 = sma200Value != null ? latest.close > sma200Value : null;
  const closeInUpperHalf = latest.high > latest.low ? (latest.close - latest.low) / (latest.high - latest.low) >= 0.6 : true;

  const trendHealthy = stockAboveSma20 === true && stockAboveSma50 === true && stockAboveSma200 === true;
  const nearBreakout = distanceToBreakoutPct != null && distanceToBreakoutPct <= 3;
  const nearEnoughForWatch = distanceToBreakoutPct != null && distanceToBreakoutPct <= 6;
  const tightRange = range10Pct != null && range10Pct <= 12;
  const decentRange = range10Pct != null && range10Pct <= 16;
  const volumeStrong = relativeVolume != null && relativeVolume >= 1.1;
  const epDay = dayChangePct != null && dayChangePct >= 4 && relativeVolume != null && relativeVolume >= 1.8 && closeInUpperHalf;
  const epWatch = dayChangePct != null && dayChangePct >= 3 && relativeVolume != null && relativeVolume >= 1.3;
  const tooExtended =
    distanceToBreakoutPct != null &&
    (distanceToBreakoutPct <= -3 || (distanceToBreakoutPct <= -1.5 && dayChangePct != null && dayChangePct >= 5));

  let signal: TacticalSignal = "AVOID";
  let setupType: TacticalSetupType = "Defensive";

  if (epDay && trendHealthy && spyHealthy) {
    signal = "BUY";
    setupType = "Q EP Daily";
  } else if (trendHealthy && spyHealthy && nearBreakout && tightRange && volumeStrong) {
    signal = "BUY";
    setupType = "Q Breakout";
  } else if ((trendHealthy && nearEnoughForWatch && decentRange) || (epWatch && stockAboveSma50 !== false)) {
    signal = "WATCH";
    setupType = epWatch ? "Q EP Daily" : "Momentum Watch";
  }

  const entry = signal === "BUY" ? latest.close : Math.max(latest.close, prior20High);
  const supportFloor = Math.max(entry * 0.95, low10 * 0.995);
  const stop = supportFloor < entry ? supportFloor : entry * 0.95;
  const targets = buildTechnicalTargets({
    bars: asc,
    entry,
    stop,
    strategy_version: "tactical_momentum_v1",
  });

  const setupLabel =
    setupType === "Q EP Daily"
      ? "episodic pivot style"
      : setupType === "Q Breakout"
        ? "tight breakout style"
        : setupType === "Momentum Watch"
          ? "momentum watch"
          : "defensive";
  const trendText = trendHealthy ? "trend aligned above key moving averages" : stockAboveSma200 === false ? "trend below SMA200" : "trend mixed";
  const breakoutText =
    distanceToBreakoutPct == null
      ? "breakout distance unavailable"
      : distanceToBreakoutPct <= 0
        ? "already through prior 20-bar high"
        : `${round2(distanceToBreakoutPct)}% below prior 20-bar high`;
  const volumeText = relativeVolume == null ? "volume unavailable" : `${round2(relativeVolume)}x relative volume`;
  const marketText = spyHealthy ? "SPY healthy" : "SPY weak";
  const timingState: TacticalTimingState =
    signal === "AVOID" ? "DEFENSIVE" : tooExtended ? "TOO_EXTENDED" : signal === "BUY" ? "BUY_READY" : "NEAR_TRIGGER";
  const timingLabel =
    timingState === "BUY_READY"
      ? "Buy-ready"
      : timingState === "NEAR_TRIGGER"
        ? "Near trigger"
        : timingState === "TOO_EXTENDED"
          ? "Too extended"
          : "Defensive";
  const rankingScoreRaw =
    (setupType === "Q EP Daily" ? 76 : setupType === "Q Breakout" ? 72 : setupType === "Momentum Watch" ? 56 : 28) +
    (trendHealthy ? 10 : 0) +
    (spyHealthy ? 6 : -4) +
    (nearBreakout ? 8 : nearEnoughForWatch ? 3 : -2) +
    (tightRange ? 6 : decentRange ? 2 : -3) +
    (volumeStrong ? 6 : relativeVolume != null ? Math.max(-3, Math.min(3, (relativeVolume - 1) * 8)) : 0) +
    (epDay ? 6 : epWatch ? 2 : 0) +
    (tooExtended ? -14 : 0) +
    (stockAboveSma200 === false ? -12 : 0);
  const rankingScore = Math.max(0, Math.min(100, round2(rankingScoreRaw) ?? 0));

  return {
    symbol: item.symbol,
    name: item.name,
    group: item.group,
    setup_type: setupType,
    timing_state: timingState,
    timing_label: timingLabel,
    ranking_score: rankingScore,
    current_price: round2(latest.close),
    breakout_level: round2(prior20High),
    distance_to_breakout_pct: round2(distanceToBreakoutPct),
    relative_volume: round2(relativeVolume),
    day_change_pct: round2(dayChangePct),
    range_10d_pct: round2(range10Pct),
    stock_above_sma20: stockAboveSma20,
    stock_above_sma50: stockAboveSma50,
    stock_above_sma200: stockAboveSma200,
    market_spy_above_sma200: spyHealthy,
    signal,
    entry_price: round2(entry),
    stop_price: round2(stop),
    tp1_price: targets.tp1,
    tp2_price: targets.tp2,
    target_model: targets.target_model,
    tp1_reason: targets.tp1_reason,
    tp2_reason: targets.tp2_reason,
    reason_summary: `${setupLabel} • ${breakoutText} • ${volumeText} • ${trendText} • ${marketText}`,
    source_date: latest.date,
    bars_count: barsDesc.length,
  };
}

export async function GET(req: Request) {
  try {
    const reqUrl = new URL(req.url);
    const maxSymbolsParam = Number(reqUrl.searchParams.get("limit") ?? reqUrl.searchParams.get("max_symbols") ?? "");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: "Missing Supabase environment" }, { status: 500 });
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } }) as any;
    const spyBars = await fetchBarsForSymbol(supabase, "SPY", 260);
    if (spyBars.length < 200) {
      return NextResponse.json({ ok: false, error: "Not enough SPY bars to evaluate market filter" }, { status: 500 });
    }

    const spyAsc = [...spyBars].reverse();
    const spyClose = spyBars[0].close;
    const spySma50 = sma(spyAsc.map((bar) => bar.close), 50);
    const spySma200 = sma(spyAsc.map((bar) => bar.close), 200);
    const spyHealthy = Boolean(spySma50 != null && spySma200 != null && spyClose > spySma50 && spyClose > spySma200);
    const scanDate = spyBars[0]?.date ?? "";
    const marketScan = await loadMarketScanSymbols(supabase, {
      scanDate,
      maxSymbols: Number.isFinite(maxSymbolsParam) ? maxSymbolsParam : 500,
    });
    const barsBySymbol = await fetchBarsBySymbol(supabase, marketScan.symbols, 260);

    const rows: TacticalMomentumRow[] = [];
    const missingSymbols: string[] = [];
    const symbolDates: Array<{ symbol: string; source_date: string | null }> = [];

    for (const item of marketScan.items) {
      const bars = barsBySymbol.get(item.symbol) ?? [];
      if (bars.length < 60) missingSymbols.push(item.symbol);
      const row = evaluateRow(item, bars, spyHealthy);
      rows.push(row);
      symbolDates.push({ symbol: item.symbol, source_date: row.source_date });
    }

    const summary = rows.reduce(
      (acc, row) => {
        if (row.signal === "BUY") acc.buy += 1;
        else if (row.signal === "WATCH") acc.watch += 1;
        else acc.avoid += 1;
        return acc;
      },
      { buy: 0, watch: 0, avoid: 0 }
    );
    const setupSummary = rows.reduce(
      (acc, row) => {
        if (row.setup_type === "Q Breakout") acc.breakout += 1;
        else if (row.setup_type === "Q EP Daily") acc.ep += 1;
        else if (row.setup_type === "Momentum Watch") acc.watch += 1;
        else acc.defensive += 1;
        return acc;
      },
      { breakout: 0, ep: 0, watch: 0, defensive: 0 }
    );
    const timingSummary = rows.reduce(
      (acc, row) => {
        if (row.timing_state === "BUY_READY") acc.buy_ready += 1;
        else if (row.timing_state === "NEAR_TRIGGER") acc.near_trigger += 1;
        else if (row.timing_state === "TOO_EXTENDED") acc.too_extended += 1;
        else acc.defensive += 1;
        return acc;
      },
      { buy_ready: 0, near_trigger: 0, too_extended: 0, defensive: 0 }
    );
    const sortedRows = [...rows].sort((a, b) => {
      const timingOrder: Record<TacticalTimingState, number> = {
        BUY_READY: 0,
        NEAR_TRIGGER: 1,
        TOO_EXTENDED: 2,
        DEFENSIVE: 3,
      };
      const timingDiff = timingOrder[a.timing_state] - timingOrder[b.timing_state];
      if (timingDiff !== 0) return timingDiff;
      const scoreDiff = Number(b.ranking_score ?? -999) - Number(a.ranking_score ?? -999);
      if (scoreDiff !== 0) return scoreDiff;
      const rvDiff = Number(b.relative_volume ?? -999) - Number(a.relative_volume ?? -999);
      if (rvDiff !== 0) return rvDiff;
      return a.symbol.localeCompare(b.symbol);
    });
    const shortlist = sortedRows
      .filter((row) => row.signal !== "AVOID")
      .sort((a, b) => {
        const scoreDiff = Number(b.ranking_score ?? -999) - Number(a.ranking_score ?? -999);
        if (scoreDiff !== 0) return scoreDiff;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 5)
      .map((row) => ({
        symbol: row.symbol,
        setup_type: row.setup_type,
        timing_state: row.timing_state,
        timing_label: row.timing_label,
        ranking_score: row.ranking_score,
        reason_summary: row.reason_summary,
      }));

    const expectedDate = spyBars[0]?.date ?? null;
    const staleSymbols = symbolDates.filter((entry) => entry.source_date && expectedDate && entry.source_date < expectedDate) as Array<{ symbol: string; source_date: string }>;
    const symbolDatesWithBars = symbolDates.filter((entry) => entry.source_date) as Array<{ symbol: string; source_date: string }>;
    const oldestSymbolDate =
      symbolDatesWithBars.length > 0 ? [...symbolDatesWithBars].sort((a, b) => a.source_date.localeCompare(b.source_date))[0].source_date : null;
    const freshnessState: TacticalFreshnessState =
      staleSymbols.length === 0 ? "current" : staleSymbols.length === symbolDatesWithBars.length && staleSymbols.length > 0 ? "stale" : "mixed";

    return NextResponse.json({
      ok: true,
      rows: sortedRows,
      summary,
      meta: {
        scan_mode: "market",
        source_universes: marketScan.source_universes,
        candidate_symbols_count: marketScan.candidate_symbols_count,
        scanned_symbols_count: marketScan.scanned_symbols_count,
        source_date: rows.map((row) => row.source_date).filter(Boolean).sort().slice(-1)[0] ?? null,
        setup_summary: setupSummary,
        timing_summary: timingSummary,
        shortlist,
        market: {
          spy_close: round2(spyClose),
          spy_sma50: round2(spySma50),
          spy_sma200: round2(spySma200),
          spy_above_sma200: spyHealthy,
          source_date: spyBars[0]?.date ?? null,
        },
        freshness: {
          expected_date: expectedDate,
          latest_symbol_date: rows.map((row) => row.source_date).filter(Boolean).sort().slice(-1)[0] ?? null,
          oldest_symbol_date: oldestSymbolDate,
          stale_symbols_count: staleSymbols.length,
          stale_symbols: staleSymbols,
          state: freshnessState,
        },
        missing_symbols: missingSymbols,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message ?? "Failed to load tactical momentum") }, { status: 500 });
  }
}
