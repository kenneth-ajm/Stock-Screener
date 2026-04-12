import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { TACTICAL_MOMENTUM_WATCHLIST, type TacticalMomentumWatchItem } from "@/lib/tactical_momentum_watchlist";

export const dynamic = "force-dynamic";

type TacticalSignal = "BUY" | "WATCH" | "AVOID";
type TacticalSetupType = "Q Breakout" | "Q EP Daily" | "Momentum Watch" | "Defensive";

type TacticalMomentumRow = {
  symbol: string;
  name: string;
  group: string;
  setup_type: TacticalSetupType;
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
  reason_summary: string;
  source_date: string | null;
  bars_count: number;
};

type TacticalFreshnessState = "current" | "mixed" | "stale";

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
  for (let i = 0; i < uniqueSymbols.length; i += 8) {
    const chunk = uniqueSymbols.slice(i, i + 8);
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

function evaluateRow(item: TacticalMomentumWatchItem, barsDesc: PriceBar[], spyHealthy: boolean): TacticalMomentumRow {
  if (!Array.isArray(barsDesc) || barsDesc.length < 60) {
    return {
      symbol: item.symbol,
      name: item.name,
      group: item.group,
      setup_type: "Defensive",
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
  const riskPerShare = Math.max(entry - stop, entry * 0.03);
  const tp1 = entry + riskPerShare * 1.5;
  const tp2 = entry + riskPerShare * 3;

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

  return {
    symbol: item.symbol,
    name: item.name,
    group: item.group,
    setup_type: setupType,
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
    tp1_price: round2(tp1),
    tp2_price: round2(tp2),
    reason_summary: `${setupLabel} • ${breakoutText} • ${volumeText} • ${trendText} • ${marketText}`,
    source_date: latest.date,
    bars_count: barsDesc.length,
  };
}

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: "Missing Supabase environment" }, { status: 500 });
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } }) as any;
    const symbols = TACTICAL_MOMENTUM_WATCHLIST.map((item) => item.symbol);
    const barsBySymbol = await fetchBarsBySymbol(supabase, [...symbols, "SPY"], 260);
    const spyBars = barsBySymbol.get("SPY") ?? [];
    if (spyBars.length < 200) {
      return NextResponse.json({ ok: false, error: "Not enough SPY bars to evaluate market filter" }, { status: 500 });
    }

    const spyAsc = [...spyBars].reverse();
    const spyClose = spyBars[0].close;
    const spySma50 = sma(spyAsc.map((bar) => bar.close), 50);
    const spySma200 = sma(spyAsc.map((bar) => bar.close), 200);
    const spyHealthy = Boolean(spySma50 != null && spySma200 != null && spyClose > spySma50 && spyClose > spySma200);

    const rows: TacticalMomentumRow[] = [];
    const missingSymbols: string[] = [];
    const symbolDates: Array<{ symbol: string; source_date: string | null }> = [];

    for (const item of TACTICAL_MOMENTUM_WATCHLIST) {
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

    const expectedDate = spyBars[0]?.date ?? null;
    const staleSymbols = symbolDates.filter((entry) => entry.source_date && expectedDate && entry.source_date < expectedDate) as Array<{ symbol: string; source_date: string }>;
    const symbolDatesWithBars = symbolDates.filter((entry) => entry.source_date) as Array<{ symbol: string; source_date: string }>;
    const oldestSymbolDate =
      symbolDatesWithBars.length > 0 ? [...symbolDatesWithBars].sort((a, b) => a.source_date.localeCompare(b.source_date))[0].source_date : null;
    const freshnessState: TacticalFreshnessState =
      staleSymbols.length === 0 ? "current" : staleSymbols.length === symbolDatesWithBars.length && staleSymbols.length > 0 ? "stale" : "mixed";

    return NextResponse.json({
      ok: true,
      rows,
      summary,
      meta: {
        watchlist_size: TACTICAL_MOMENTUM_WATCHLIST.length,
        source_date: rows.map((row) => row.source_date).filter(Boolean).sort().slice(-1)[0] ?? null,
        setup_summary: setupSummary,
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
