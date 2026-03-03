import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_MAX_HOLDING_DAYS,
  evaluateCoreMomentumSwing,
  sma,
  type PriceBar,
  type RegimeState,
} from "@/lib/strategy/coreMomentumSwing";

type BacktestBody = {
  universe_slug?: string;
  min_years?: number;
  include_watch?: boolean;
  max_symbols?: number;
};

type SimTrade = {
  symbol: string;
  signal_date: string;
  entry_date: string;
  signal: "BUY" | "WATCH";
  return_pct: number;
  exit_reason: "STOP" | "TP2" | "TIME";
};

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars for admin client");
  return createClient(url, key, { auth: { persistSession: false } });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function daysAgoDateString(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function simulateTradePath(opts: {
  bars: PriceBar[];
  entryIndex: number;
  signal: "BUY" | "WATCH";
}) {
  const entryBar = opts.bars[opts.entryIndex];
  if (!entryBar) return null;

  const entry = entryBar.open;
  if (!(entry > 0)) return null;

  const stop = entry * 0.92;
  const tp1 = entry * 1.05;
  const tp2 = entry * 1.1;
  let remaining = 1;
  let pnlPct = 0;
  let tookTp1 = false;

  const maxIdx = Math.min(opts.bars.length - 1, opts.entryIndex + CORE_MOMENTUM_MAX_HOLDING_DAYS - 1);

  for (let i = opts.entryIndex; i <= maxIdx; i++) {
    const bar = opts.bars[i];
    if (!bar) break;
    const stopHit = bar.low <= stop;
    const tp1Hit = bar.high >= tp1;
    const tp2Hit = bar.high >= tp2;

    // Conservative sequencing: if stop and target hit same day, stop wins.
    if (stopHit && remaining > 0) {
      pnlPct += remaining * ((stop - entry) / entry);
      remaining = 0;
      return {
        return_pct: pnlPct,
        exit_reason: "STOP" as const,
        exit_date: bar.date,
      };
    }

    if (!tookTp1 && tp1Hit) {
      const take = Math.min(remaining, 0.5);
      pnlPct += take * ((tp1 - entry) / entry);
      remaining -= take;
      tookTp1 = true;
    }

    if (tp2Hit && remaining > 0) {
      pnlPct += remaining * ((tp2 - entry) / entry);
      remaining = 0;
      return {
        return_pct: pnlPct,
        exit_reason: "TP2" as const,
        exit_date: bar.date,
      };
    }

    if (i === maxIdx && remaining > 0) {
      pnlPct += remaining * ((bar.close - entry) / entry);
      remaining = 0;
      return {
        return_pct: pnlPct,
        exit_reason: "TIME" as const,
        exit_date: bar.date,
      };
    }
  }

  return null;
}

function summarizeTrades(trades: SimTrade[]) {
  if (trades.length === 0) {
    return {
      trades: 0,
      win_rate: 0,
      avg_return_pct: 0,
      expectancy_pct: 0,
      max_drawdown_pct: 0,
      profit_factor: 0,
    };
  }

  const wins = trades.filter((t) => t.return_pct > 0);
  const winRate = wins.length / trades.length;
  const avgReturn = trades.reduce((sum, t) => sum + t.return_pct, 0) / trades.length;
  const expectancy = avgReturn;

  const grossProfit = trades.filter((t) => t.return_pct > 0).reduce((sum, t) => sum + t.return_pct, 0);
  const grossLossAbs =
    trades.filter((t) => t.return_pct < 0).reduce((sum, t) => sum + Math.abs(t.return_pct), 0) || 0;
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? 99 : 0;

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const t of trades) {
    equity *= 1 + t.return_pct;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, dd);
  }

  return {
    trades: trades.length,
    win_rate: clamp(winRate, 0, 1),
    avg_return_pct: avgReturn * 100,
    expectancy_pct: expectancy * 100,
    max_drawdown_pct: maxDrawdown * 100,
    profit_factor: profitFactor,
  };
}

export async function POST(req: Request) {
  try {
    const supabase = admin();
    const body = (await req.json().catch(() => ({}))) as BacktestBody;

    const universeSlug = body.universe_slug ?? CORE_MOMENTUM_DEFAULT_UNIVERSE;
    const minYears = Math.max(3, Number(body.min_years ?? 3));
    const includeWatch = Boolean(body.include_watch ?? false);
    const maxSymbols = Math.max(20, Math.min(1200, Number(body.max_symbols ?? 800)));
    const lookbackDays = Math.ceil(minYears * 365.25);
    const startDate = daysAgoDateString(lookbackDays);

    const { data: universe, error: uErr } = await supabase
      .from("universes")
      .select("id,slug")
      .eq("slug", universeSlug)
      .single();
    if (uErr || !universe) {
      return NextResponse.json({ ok: false, error: `Universe not found: ${universeSlug}` }, { status: 400 });
    }

    const { data: members, error: mErr } = await supabase
      .from("universe_members")
      .select("symbol")
      .eq("universe_id", universe.id)
      .eq("active", true)
      .order("symbol", { ascending: true })
      .limit(maxSymbols);
    if (mErr) throw mErr;

    const symbols = (members ?? []).map((m) => String(m.symbol ?? "").toUpperCase()).filter(Boolean);
    if (symbols.length === 0) {
      return NextResponse.json({ ok: false, error: `No active members in ${universeSlug}` }, { status: 400 });
    }

    const { data: spyBars, error: spyErr } = await supabase
      .from("price_bars")
      .select("date,close")
      .eq("symbol", "SPY")
      .eq("source", "polygon")
      .gte("date", startDate)
      .order("date", { ascending: true });
    if (spyErr || !spyBars || spyBars.length < 220) {
      return NextResponse.json({ ok: false, error: "Not enough SPY history for regime computation" }, { status: 400 });
    }

    const regimeByDate = new Map<string, RegimeState>();
    const spyCloseSeries: number[] = [];
    for (const row of spyBars) {
      spyCloseSeries.push(Number(row.close));
      const sma200 = sma(spyCloseSeries, 200);
      if (!sma200) continue;
      const state: RegimeState = Number(row.close) > sma200 ? "FAVORABLE" : "DEFENSIVE";
      regimeByDate.set(String(row.date), state);
    }

    const tradesBuy: SimTrade[] = [];
    const tradesWatch: SimTrade[] = [];
    let evaluatedSignals = 0;
    let skippedDueToRegimeDate = 0;

    for (const symbol of symbols) {
      const { data: bars, error: bErr } = await supabase
        .from("price_bars")
        .select("date,open,high,low,close,volume")
        .eq("symbol", symbol)
        .eq("source", "polygon")
        .gte("date", daysAgoDateString(lookbackDays + 450))
        .order("date", { ascending: true });

      if (bErr || !bars || bars.length < 260) continue;

      const cleanBars: PriceBar[] = bars.map((bar) => ({
        date: String(bar.date),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume),
      }));

      for (let i = 220; i < cleanBars.length - 1; i++) {
        const signalDate = cleanBars[i].date;
        if (signalDate < startDate) continue;
        const regime = regimeByDate.get(signalDate);
        if (!regime) {
          skippedDueToRegimeDate += 1;
          continue;
        }

        const evalResult = evaluateCoreMomentumSwing({
          bars: cleanBars.slice(0, i + 1),
          regime,
        });
        if (!evalResult) continue;
        if (evalResult.signal === "AVOID") continue;
        if (!includeWatch && evalResult.signal !== "BUY") continue;

        const sim = simulateTradePath({
          bars: cleanBars,
          entryIndex: i + 1,
          signal: evalResult.signal,
        });
        if (!sim) continue;

        evaluatedSignals += 1;
        const trade: SimTrade = {
          symbol,
          signal_date: signalDate,
          entry_date: cleanBars[i + 1].date,
          signal: evalResult.signal,
          return_pct: sim.return_pct,
          exit_reason: sim.exit_reason,
        };

        if (evalResult.signal === "BUY") tradesBuy.push(trade);
        else tradesWatch.push(trade);
      }
    }

    const buyMetrics = summarizeTrades(tradesBuy);
    const watchMetrics = summarizeTrades(tradesWatch);
    const combinedTrades = [...tradesBuy, ...tradesWatch];
    const combinedMetrics = summarizeTrades(combinedTrades);

    const thresholdTarget = {
      min_win_rate: 0.6,
      min_profit_factor: 1.4,
      buy_passes: buyMetrics.win_rate >= 0.6 && buyMetrics.profit_factor >= 1.4,
      combined_passes: combinedMetrics.win_rate >= 0.6 && combinedMetrics.profit_factor >= 1.4,
    };

    return NextResponse.json({
      ok: true,
      strategy: "core_momentum_swing_v2",
      universe_slug: universeSlug,
      start_date: startDate,
      include_watch: includeWatch,
      assumptions: {
        entry: "next_day_open_after_signal",
        stop: "8pct_below_entry",
        take_profit: "tp1_5pct_then_tp2_10pct",
        max_holding_days: CORE_MOMENTUM_MAX_HOLDING_DAYS,
        same_day_collision_rule: "conservative_stop_first",
      },
      coverage: {
        symbols_considered: symbols.length,
        evaluated_signals: evaluatedSignals,
        skipped_due_to_missing_regime_date: skippedDueToRegimeDate,
      },
      metrics: {
        buy: buyMetrics,
        watch: watchMetrics,
        combined: combinedMetrics,
      },
      target: thresholdTarget,
      sample_trades: combinedTrades.slice(0, 25),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
