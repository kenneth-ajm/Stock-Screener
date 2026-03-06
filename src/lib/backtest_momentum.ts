export type BacktestInput = {
  start_date: string;
  end_date: string;
  universe_slug?: string;
  strategy_version?: string;
  entry_mode?: "trigger" | "next_open" | "next_close";
};

export type BacktestTrade = {
  symbol: string;
  signal_date: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  stop: number;
  tp1: number;
  exit_reason: "stop" | "tp1" | "time_stop";
  return_pct: number;
  holding_days: number;
};

export type EquityPoint = {
  date: string;
  equity: number;
};

export type BacktestSummary = {
  candidate_rows: number;
  total_trades: number;
  triggered_trades: number;
  not_triggered_trades: number;
  skipped_trades: number;
  skip_reason_counts: {
    triggered: number;
    not_triggered_within_window: number;
    no_day_after_signal: number;
    invalid_signal_entry: number;
  };
  win_rate: number;
  avg_return_pct: number;
  avg_holding_days: number;
  gross_return_pct: number;
  max_drawdown_pct: number | null;
  profit_factor: number;
  exit_reason_counts: {
    stop: number;
    tp1: number;
    time_stop: number;
  };
};

function buildEquityCurve(startDate: string, trades: BacktestTrade[]): EquityPoint[] {
  let equity = 100;
  const curve: EquityPoint[] = [{ date: startDate, equity }];
  for (const t of trades) {
    equity = equity * (1 + t.return_pct / 100);
    curve.push({
      date: t.exit_date,
      equity: Math.round(equity * 10000) / 10000,
    });
  }
  return curve;
}

type Bar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type SignalRow = {
  symbol: string;
  date: string;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
};

const DEFAULT_UNIVERSE = "core_800";
const MOMENTUM_STRATEGY = "v2_core_momentum";
const DEFAULT_MAX_HOLD_DAYS = 7;
const MAX_WAIT_DAYS = 10;

function normalizeEntryMode(v: unknown): "trigger" | "next_open" | "next_close" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "next_open" || s === "next_close" || s === "trigger") return s;
  return "trigger";
}

function entryRuleText(mode: "trigger" | "next_open" | "next_close") {
  if (mode === "next_open") return "next_trading_day_open";
  if (mode === "next_close") return "next_trading_day_close";
  return "wait_up_to_10_days_for_high_to_reach_signal_entry";
}

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function toDateOnly(input: string) {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function diffDays(a: string, b: string) {
  const ms = toDateOnly(b).getTime() - toDateOnly(a).getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function summarizeTrades(
  candidate_rows: number,
  trades: BacktestTrade[],
  skipped_trades: number,
  not_triggered_trades: number,
  skip_reason_counts: {
    triggered: number;
    not_triggered_within_window: number;
    no_day_after_signal: number;
    invalid_signal_entry: number;
  }
): BacktestSummary {
  const total = trades.length;
  const wins = trades.filter((t) => t.return_pct > 0).length;
  const winRate = total > 0 ? wins / total : 0;
  const avgReturn = total > 0 ? trades.reduce((s, t) => s + t.return_pct, 0) / total : 0;
  const avgHold = total > 0 ? trades.reduce((s, t) => s + t.holding_days, 0) / total : 0;

  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let hasEquity = false;
  let grossProfit = 0;
  let grossLossAbs = 0;
  for (const t of trades) {
    const r = t.return_pct / 100;
    equity *= 1 + r;
    hasEquity = true;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    maxDd = Math.max(maxDd, dd);
    if (r > 0) grossProfit += r;
    if (r < 0) grossLossAbs += Math.abs(r);
  }

  const grossReturn = hasEquity ? (equity - 1) * 100 : 0;
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? 99 : 0;

  const counts = {
    stop: trades.filter((t) => t.exit_reason === "stop").length,
    tp1: trades.filter((t) => t.exit_reason === "tp1").length,
    time_stop: trades.filter((t) => t.exit_reason === "time_stop").length,
  };

  return {
    candidate_rows,
    total_trades: total,
    triggered_trades: total,
    not_triggered_trades,
    skipped_trades,
    skip_reason_counts,
    win_rate: clamp(winRate, 0, 1),
    avg_return_pct: avgReturn,
    avg_holding_days: avgHold,
    gross_return_pct: grossReturn,
    max_drawdown_pct: hasEquity ? maxDd * 100 : null,
    profit_factor: profitFactor,
    exit_reason_counts: counts,
  };
}

export async function runMomentumBacktest(opts: { supabase: any; input: BacktestInput }) {
  const supa = opts.supabase as any;
  const start = String(opts.input.start_date ?? "").slice(0, 10);
  const end = String(opts.input.end_date ?? "").slice(0, 10);
  const universe = String(opts.input.universe_slug ?? DEFAULT_UNIVERSE).trim() || DEFAULT_UNIVERSE;
  const strategy = String(opts.input.strategy_version ?? MOMENTUM_STRATEGY).trim() || MOMENTUM_STRATEGY;
  const entry_mode = normalizeEntryMode(opts.input.entry_mode);

  if (!start || !end) {
    throw new Error("start_date and end_date are required");
  }

  const { data: scans, error: scanErr } = await supa
    .from("daily_scans")
    .select("symbol,date,entry,stop,tp1")
    .eq("universe_slug", universe)
    .eq("strategy_version", strategy)
    .eq("signal", "BUY")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true })
    .order("symbol", { ascending: true })
    .limit(20000);
  if (scanErr) throw scanErr;

  const signals = (scans ?? []) as SignalRow[];
  if (signals.length === 0) {
    return {
      assumptions: {
        source: "daily_scans BUY signals",
        strategy_version: strategy,
        entry_mode,
        entry_rule: entryRuleText(entry_mode),
        exits: "stop, tp1, time_stop",
        max_hold_days_fallback: DEFAULT_MAX_HOLD_DAYS,
        max_wait_days: MAX_WAIT_DAYS,
      },
      summary: summarizeTrades(0, [], 0, 0, {
        triggered: 0,
        not_triggered_within_window: 0,
        no_day_after_signal: 0,
        invalid_signal_entry: 0,
      }),
      trades: [] as BacktestTrade[],
      equity_curve: buildEquityCurve(start, []),
    };
  }

  const symbols = Array.from(new Set(signals.map((s) => String(s.symbol ?? "").trim().toUpperCase()).filter(Boolean)));
  const { data: barsData, error: barsErr } = await supa
    .from("price_bars")
    .select("symbol,date,open,high,low,close")
    .in("symbol", symbols)
    .gte("date", start)
    .lte("date", end)
    .order("symbol", { ascending: true })
    .order("date", { ascending: true })
    .limit(500000);
  if (barsErr) throw barsErr;

  const barsBySymbol = new Map<string, Bar[]>();
  for (const row of barsData ?? []) {
    const sym = String(row?.symbol ?? "").trim().toUpperCase();
    if (!sym) continue;
    const open = toNum(row?.open);
    const high = toNum(row?.high);
    const low = toNum(row?.low);
    const close = toNum(row?.close);
    const date = String(row?.date ?? "");
    if (!date || open === null || high === null || low === null || close === null) continue;
    if (!barsBySymbol.has(sym)) barsBySymbol.set(sym, []);
    barsBySymbol.get(sym)!.push({ date, open, high, low, close });
  }

  const trades: BacktestTrade[] = [];
  let skipped = 0;
  let notTriggered = 0;
  let noDayAfterSignal = 0;
  let invalidSignalEntry = 0;

  for (const s of signals) {
    const sym = String(s.symbol ?? "").trim().toUpperCase();
    const bars = barsBySymbol.get(sym) ?? [];
    if (bars.length < 2) {
      skipped += 1;
      continue;
    }
    const waitStartIdx = bars.findIndex((b) => b.date > s.date);
    if (waitStartIdx < 0) {
      skipped += 1;
      noDayAfterSignal += 1;
      continue;
    }

    let entryIdx = -1;
    let entry: number | null = null;
    if (entry_mode === "trigger") {
      const signalEntry = toNum(s.entry);
      if (signalEntry === null || !(signalEntry > 0)) {
        skipped += 1;
        invalidSignalEntry += 1;
        continue;
      }
      const waitEndIdx = Math.min(bars.length - 1, waitStartIdx + MAX_WAIT_DAYS - 1);
      for (let i = waitStartIdx; i <= waitEndIdx; i++) {
        const high = toNum(bars[i]?.high);
        if (high !== null && high >= signalEntry) {
          entryIdx = i;
          break;
        }
      }
      if (entryIdx < 0) {
        notTriggered += 1;
        continue;
      }
      entry = signalEntry;
    } else if (entry_mode === "next_open") {
      entryIdx = waitStartIdx;
      entry = toNum(bars[entryIdx]?.open);
    } else {
      entryIdx = waitStartIdx;
      entry = toNum(bars[entryIdx]?.close);
    }

    const entryBar = bars[entryIdx];
    const stop = toNum(s.stop);
    const tp1 = toNum(s.tp1);
    if (entry === null || !(entry > 0) || stop === null || !(stop > 0) || tp1 === null || !(tp1 > 0)) {
      skipped += 1;
      continue;
    }

    const maxHold = DEFAULT_MAX_HOLD_DAYS;
    const maxIdx = Math.min(bars.length - 1, entryIdx + maxHold - 1);
    let exitPrice = toNum(bars[maxIdx]?.close) ?? entry;
    let exitDate = bars[maxIdx]?.date ?? entryBar.date;
    let exitReason: BacktestTrade["exit_reason"] = "time_stop";

    let finished = false;
    for (let i = entryIdx; i <= maxIdx; i++) {
      const bar = bars[i];
      if (!bar) continue;
      const low = toNum(bar.low);
      const high = toNum(bar.high);
      if (low !== null && low <= stop) {
        exitPrice = stop;
        exitDate = bar.date;
        exitReason = "stop";
        finished = true;
      } else if (high !== null && high >= tp1) {
        exitPrice = tp1;
        exitDate = bar.date;
        exitReason = "tp1";
        finished = true;
      }
      if (finished) break;
      if (i === maxIdx) {
        exitPrice = toNum(bar.close) ?? entry;
        exitDate = bar.date;
        exitReason = "time_stop";
      }
    }

    const retPct = ((exitPrice - entry) / entry) * 100;
    trades.push({
      symbol: sym,
      signal_date: s.date,
      entry_date: entryBar.date,
      exit_date: exitDate,
      entry_price: entry,
      exit_price: exitPrice,
      stop,
      tp1,
      exit_reason: exitReason,
      return_pct: retPct,
      holding_days: diffDays(entryBar.date, exitDate),
    });
  }

  const sortedTrades = trades.sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date.localeCompare(b.entry_date);
    return a.symbol.localeCompare(b.symbol);
  });

  return {
    assumptions: {
      source: "daily_scans BUY signals",
      strategy_version: strategy,
      entry_mode,
      entry_rule: entryRuleText(entry_mode),
      exits: "stop, tp1, time_stop",
      max_hold_days_fallback: DEFAULT_MAX_HOLD_DAYS,
      max_wait_days: MAX_WAIT_DAYS,
    },
    summary: summarizeTrades(signals.length, sortedTrades, skipped, notTriggered, {
      triggered: sortedTrades.length,
      not_triggered_within_window: notTriggered,
      no_day_after_signal: noDayAfterSignal,
      invalid_signal_entry: invalidSignalEntry,
    }),
    trades: sortedTrades,
    equity_curve: buildEquityCurve(start, sortedTrades),
  };
}
