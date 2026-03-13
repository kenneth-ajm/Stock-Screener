import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { QUALITY_DIP_WATCHLIST, type QualityDipWatchItem } from "@/lib/quality_dip_watchlist";

export const dynamic = "force-dynamic";

type DipSignal = "CONSIDER_BUY" | "WATCH" | "AVOID";

type QualityDipRow = {
  symbol: string;
  name: string;
  group: string;
  current_price: number | null;
  high_30d: number | null;
  drop_pct_from_30d_high: number | null;
  stock_above_sma200: boolean | null;
  market_spy_above_sma200: boolean;
  signal: DipSignal;
  reason_summary: string;
  source_date: string | null;
  bars_count: number;
};

function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const total = slice.reduce((sum, v) => sum + v, 0);
  return total / period;
}

function round2(n: number | null) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

async function fetchBars(supa: any, symbol: string, limit = 260) {
  const { data, error } = await supa
    .from("price_bars")
    .select("date,high,close")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row: any) => ({
      date: typeof row?.date === "string" ? row.date : null,
      high: toNumber(row?.high),
      close: toNumber(row?.close),
    }))
    .filter((row) => row.date && row.close != null && row.high != null) as Array<{ date: string; high: number; close: number }>;
}

function evaluateRow(item: QualityDipWatchItem, barsDesc: Array<{ date: string; high: number; close: number }>, spyAboveSma200: boolean): QualityDipRow {
  if (!Array.isArray(barsDesc) || barsDesc.length < 30) {
    return {
      symbol: item.symbol,
      name: item.name,
      group: item.group,
      current_price: null,
      high_30d: null,
      drop_pct_from_30d_high: null,
      stock_above_sma200: null,
      market_spy_above_sma200: spyAboveSma200,
      signal: "AVOID",
      reason_summary: "Insufficient price history (need at least 30 daily bars).",
      source_date: barsDesc?.[0]?.date ?? null,
      bars_count: barsDesc.length,
    };
  }

  const asc = [...barsDesc].reverse();
  const closes = asc.map((b) => b.close);
  const latest = barsDesc[0];
  const recent30Bars = barsDesc.slice(0, 30);
  const high30 = Math.max(...recent30Bars.map((b) => b.high));
  const sma200 = sma(closes, 200);

  const current = latest.close;
  const dropPct = high30 > 0 ? ((high30 - current) / high30) * 100 : 0;
  const stockAboveSma200 = sma200 != null ? current > sma200 : null;

  const inIdealDipRange = dropPct >= 5 && dropPct <= 10;
  const inShallowDipRange = dropPct >= 3 && dropPct < 5;
  const inDeepButAcceptableWatchRange = dropPct > 10 && dropPct <= 12;
  const stockStrong = stockAboveSma200 === true;
  const marketStrong = spyAboveSma200;
  const oneConfirmationWeak = (stockStrong && !marketStrong) || (!stockStrong && marketStrong);

  let signal: DipSignal = "AVOID";
  if (inIdealDipRange && stockStrong && marketStrong) {
    signal = "CONSIDER_BUY";
  } else if (
    inShallowDipRange ||
    (inDeepButAcceptableWatchRange && stockStrong && marketStrong) ||
    ((inIdealDipRange || inDeepButAcceptableWatchRange) && oneConfirmationWeak)
  ) {
    signal = "WATCH";
  } else if (dropPct > 12 || stockAboveSma200 === false || (!stockStrong && !marketStrong)) {
    signal = "AVOID";
  }

  const dipText = inShallowDipRange
    ? "shallow dip"
    : inIdealDipRange
      ? "ideal dip zone"
      : inDeepButAcceptableWatchRange
        ? "deep dip beyond preferred range"
        : dropPct > 12
          ? "deep dip beyond preferred range"
          : "dip not in preferred zone";
  const trendText =
    stockAboveSma200 == null ? "trend unknown" : stockAboveSma200 ? "trend intact" : "broken trend";
  const marketText = marketStrong ? "SPY healthy" : "SPY weak";
  const dropText = `${round2(dropPct)}% below 30-bar high`;

  return {
    symbol: item.symbol,
    name: item.name,
    group: item.group,
    current_price: round2(current),
    high_30d: round2(high30),
    drop_pct_from_30d_high: round2(dropPct),
    stock_above_sma200: stockAboveSma200,
    market_spy_above_sma200: marketStrong,
    signal,
    reason_summary: `${dipText} • ${dropText} • ${trendText} • ${marketText}`,
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
    const spyBars = await fetchBars(supabase, "SPY", 260);
    if (spyBars.length < 200) {
      return NextResponse.json(
        {
          ok: false,
          error: "Not enough SPY bars to evaluate market filter",
          meta: { spy_bars_count: spyBars.length },
        },
        { status: 500 }
      );
    }

    const spyAsc = [...spyBars].reverse();
    const spySma200 = sma(spyAsc.map((b) => b.close), 200);
    const spyClose = spyBars[0].close;
    const spyAboveSma200 = spySma200 != null ? spyClose > spySma200 : false;

    const rows: QualityDipRow[] = [];
    const missingSymbols: string[] = [];

    for (const item of QUALITY_DIP_WATCHLIST) {
      const bars = await fetchBars(supabase, item.symbol, 260);
      if (bars.length < 30) missingSymbols.push(item.symbol);
      rows.push(evaluateRow(item, bars, spyAboveSma200));
    }

    const counts = rows.reduce(
      (acc, row) => {
        if (row.signal === "CONSIDER_BUY") acc.consider_buy += 1;
        else if (row.signal === "WATCH") acc.watch += 1;
        else acc.avoid += 1;
        return acc;
      },
      { consider_buy: 0, watch: 0, avoid: 0 }
    );

    return NextResponse.json({
      ok: true,
      rows,
      summary: counts,
      meta: {
        watchlist_size: QUALITY_DIP_WATCHLIST.length,
        source_date: rows
          .map((r) => r.source_date)
          .filter(Boolean)
          .sort()
          .slice(-1)[0] ?? null,
        market: {
          spy_close: round2(spyClose),
          spy_sma200: round2(spySma200),
          spy_above_sma200: spyAboveSma200,
          source_date: spyBars[0]?.date ?? null,
        },
        missing_symbols: missingSymbols,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(error?.message ?? "Failed to load Quality Dip watchlist"),
      },
      { status: 500 }
    );
  }
}
