import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
  evaluateCoreMomentumSwing,
  sma,
  type PriceBar,
  type RegimeState,
} from "@/lib/strategy/coreMomentumSwing";
import {
  TREND_HOLD_DEFAULT_VERSION,
  TREND_HOLD_MAX_HOLDING_DAYS,
  evaluateTrendHold,
} from "@/lib/strategy/trendHold";

type BacktestBody = {
  strategy_version?: string;
  universe_slug?: string;
  start_date?: string;
  end_date?: string;
  initial_capital?: number;
};

type SimTrade = {
  symbol: string;
  signal_date: string;
  entry_date: string;
  exit_date: string;
  return_pct: number;
  pnl_amount: number;
  hold_days: number;
  exit_reason: "STOP" | "TP1_TP2" | "TP1_TIME" | "TIME";
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

function parseDateOrDefault(input: string | undefined, fallback: string) {
  const v = String(input ?? "").trim();
  if (!v) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}

function defaultStartDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
}

function defaultEndDate() {
  return new Date().toISOString().slice(0, 10);
}

function simulateTrade(opts: {
  bars: PriceBar[];
  entryIndex: number;
  stopPct: number;
  tp1Pct: number;
  tp2Pct: number;
  maxHoldDays: number;
}) {
  const entryBar = opts.bars[opts.entryIndex];
  if (!entryBar || !(entryBar.open > 0)) return null;

  const entry = entryBar.open;
  const stop = entry * (1 - opts.stopPct);
  const tp1 = entry * (1 + opts.tp1Pct);
  const tp2 = entry * (1 + opts.tp2Pct);

  let remaining = 1;
  let pnlPct = 0;
  let tookTp1 = false;
  const maxIdx = Math.min(opts.bars.length - 1, opts.entryIndex + opts.maxHoldDays - 1);
  let exitDate = entryBar.date;
  let exitReason: SimTrade["exit_reason"] = "TIME";

  for (let i = opts.entryIndex; i <= maxIdx; i++) {
    const b = opts.bars[i];
    if (!b) break;
    const stopHit = b.low <= stop;
    const tp1Hit = b.high >= tp1;
    const tp2Hit = b.high >= tp2;

    if (stopHit && remaining > 0) {
      pnlPct += remaining * ((stop - entry) / entry);
      remaining = 0;
      exitDate = b.date;
      exitReason = "STOP";
      break;
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
      exitDate = b.date;
      exitReason = "TP1_TP2";
      break;
    }

    if (i === maxIdx && remaining > 0) {
      pnlPct += remaining * ((b.close - entry) / entry);
      remaining = 0;
      exitDate = b.date;
      exitReason = tookTp1 ? "TP1_TIME" : "TIME";
      break;
    }
  }

  return {
    returnPct: pnlPct,
    exitDate,
    exitReason,
    holdDays: Math.max(1, maxIdx - opts.entryIndex + 1),
  };
}

function summarizeTrades(trades: SimTrade[], initialCapital: number) {
  if (trades.length === 0) {
    return {
      trades: 0,
      win_rate: 0,
      avg_win_pct: 0,
      avg_loss_pct: 0,
      expectancy_pct: 0,
      profit_factor: 0,
      avg_hold_days: 0,
      max_drawdown_pct: 0,
      ending_equity: initialCapital,
    };
  }

  const wins = trades.filter((t) => t.return_pct > 0);
  const losses = trades.filter((t) => t.return_pct < 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.return_pct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.return_pct, 0) / losses.length : 0;
  const winRate = wins.length / trades.length;
  const expectancy = trades.reduce((s, t) => s + t.return_pct, 0) / trades.length;
  const grossProfit = wins.reduce((s, t) => s + t.return_pct, 0);
  const grossLossAbs = losses.reduce((s, t) => s + Math.abs(t.return_pct), 0);
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? 99 : 0;
  const avgHold = trades.reduce((s, t) => s + t.hold_days, 0) / trades.length;

  const byDate = [...trades].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDd = 0;
  for (const t of byDate) {
    equity *= 1 + t.return_pct;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    maxDd = Math.max(maxDd, dd);
  }

  return {
    trades: trades.length,
    win_rate: clamp(winRate, 0, 1),
    avg_win_pct: avgWin * 100,
    avg_loss_pct: avgLoss * 100,
    expectancy_pct: expectancy * 100,
    profit_factor: profitFactor,
    avg_hold_days: avgHold,
    max_drawdown_pct: maxDd * 100,
    ending_equity: equity,
  };
}

export async function POST(req: Request) {
  try {
    const supabase = admin();
    const body = (await req.json().catch(() => ({}))) as BacktestBody;
    const strategyVersion =
      String(body.strategy_version ?? CORE_MOMENTUM_DEFAULT_VERSION).trim() || CORE_MOMENTUM_DEFAULT_VERSION;
    const isTrend = strategyVersion === TREND_HOLD_DEFAULT_VERSION;
    const universeSlug = String(body.universe_slug ?? CORE_MOMENTUM_DEFAULT_UNIVERSE).trim() || CORE_MOMENTUM_DEFAULT_UNIVERSE;
    const startDate = parseDateOrDefault(body.start_date, defaultStartDate());
    const endDate = parseDateOrDefault(body.end_date, defaultEndDate());
    const initialCapital = Number.isFinite(Number(body.initial_capital))
      ? Number(body.initial_capital)
      : 100000;

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
      .order("symbol", { ascending: true });
    if (mErr) throw mErr;
    const symbols = (members ?? []).map((m) => String(m.symbol ?? "").toUpperCase()).filter(Boolean);
    if (symbols.length === 0) {
      return NextResponse.json({ ok: false, error: "No active symbols in universe" }, { status: 400 });
    }

    const { data: spyBarsRaw, error: spyErr } = await supabase
      .from("price_bars")
      .select("date,open,high,low,close,volume")
      .eq("symbol", "SPY")
      .eq("source", "polygon")
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });
    if (spyErr || !spyBarsRaw || spyBarsRaw.length < 252) {
      return NextResponse.json({ ok: false, error: "Not enough SPY bars for backtest window" }, { status: 400 });
    }
    const spyBars: PriceBar[] = spyBarsRaw.map((b) => ({
      date: String(b.date),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
    }));

    const regimeByDate = new Map<string, RegimeState>();
    const spyReturnByDate = new Map<string, number>();
    const spyCloses: number[] = [];
    for (let i = 0; i < spyBars.length; i++) {
      const b = spyBars[i];
      spyCloses.push(b.close);
      const sma200 = sma(spyCloses, 200);
      if (sma200) {
        regimeByDate.set(b.date, b.close > sma200 ? "FAVORABLE" : "DEFENSIVE");
      }
      if (i >= 251) {
        const start = spyBars[i - 251].close;
        spyReturnByDate.set(b.date, start > 0 ? b.close / start - 1 : 0);
      }
    }

    const trades: SimTrade[] = [];
    let evaluatedSignals = 0;

    for (const symbol of symbols) {
      const { data: barsRaw, error: bErr } = await supabase
        .from("price_bars")
        .select("date,open,high,low,close,volume")
        .eq("symbol", symbol)
        .eq("source", "polygon")
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true });
      if (bErr || !barsRaw || barsRaw.length < 252) continue;

      const bars: PriceBar[] = barsRaw.map((b) => ({
        date: String(b.date),
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume),
      }));

      for (let i = 251; i < bars.length - 1; i++) {
        const signalDate = bars[i].date;
        if (signalDate < startDate || signalDate > endDate) continue;
        const regime = regimeByDate.get(signalDate);
        if (!regime) continue;

        const evalResult = isTrend
          ? evaluateTrendHold({
              bars: bars.slice(0, i + 1),
              regime,
              spy252Return: spyReturnByDate.get(signalDate) ?? null,
            })
          : evaluateCoreMomentumSwing({
              bars: bars.slice(0, i + 1),
              regime,
            });
        if (!evalResult || evalResult.signal !== "BUY") continue;

        evaluatedSignals += 1;
        const sim = isTrend
          ? simulateTrade({
              bars,
              entryIndex: i + 1,
              stopPct: 0.1,
              tp1Pct: 0.1,
              tp2Pct: 0.2,
              maxHoldDays: TREND_HOLD_MAX_HOLDING_DAYS,
            })
          : simulateTrade({
              bars,
              entryIndex: i + 1,
              stopPct: 0.08,
              tp1Pct: 0.05,
              tp2Pct: 0.1,
              maxHoldDays: 7,
            });
        if (!sim) continue;

        const pnlAmount = initialCapital * sim.returnPct;
        trades.push({
          symbol,
          signal_date: signalDate,
          entry_date: bars[i + 1].date,
          exit_date: sim.exitDate,
          return_pct: sim.returnPct,
          pnl_amount: pnlAmount,
          hold_days: sim.holdDays,
          exit_reason: sim.exitReason,
        });
      }
    }

    const metrics = summarizeTrades(trades, initialCapital);

    return NextResponse.json({
      ok: true,
      strategy_version: strategyVersion,
      universe_slug: universeSlug,
      start_date: startDate,
      end_date: endDate,
      initial_capital: initialCapital,
      assumptions: isTrend
        ? {
            entry: "next_day_open_after_signal",
            stop: "-10%",
            tp1: "+10%",
            tp2: "+20%",
            max_hold_days: TREND_HOLD_MAX_HOLDING_DAYS,
          }
        : {
            entry: "next_day_open_after_signal",
            stop: "-8%",
            tp1: "+5%",
            tp2: "+10%",
            max_hold_days: 7,
          },
      coverage: {
        symbols_considered: symbols.length,
        evaluated_buy_signals: evaluatedSignals,
        simulated_trades: trades.length,
      },
      metrics,
      sample_trades: trades.slice(0, 50),
    });
  } catch (e: unknown) {
    console.error("backtest run error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

