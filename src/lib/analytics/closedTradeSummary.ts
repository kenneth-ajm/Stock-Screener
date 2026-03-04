export type ClosedPositionLike = {
  symbol: string | null;
  entry_price: number | null;
  exit_price: number | null;
  entry_fee?: number | null;
  exit_fee?: number | null;
  // shares field could be named differently in your schema
  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;

  // optional fields
  closed_at?: string | null;
};

export type ClosedTradeSummary = {
  trades: number;

  wins: number;
  losses: number;
  winRate: number; // 0..1

  avgWinPct: number;  // e.g. 0.07 = +7%
  avgLossPct: number; // e.g. -0.03 = -3%

  avgWinUsd: number;
  avgLossUsd: number;

  grossProfit: number;
  grossLossAbs: number; // absolute value

  profitFactor: number | null; // null if no losses
  expectancyUsd: number; // average P/L dollars per trade
};

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function safeNum(x: unknown): number | null {
  if (!isFiniteNumber(x)) return null;
  return x;
}

export function computeClosedTradeSummary(rows: ClosedPositionLike[]): ClosedTradeSummary {
  const trades = rows.length;

  let wins = 0;
  let losses = 0;

  const winPcts: number[] = [];
  const lossPcts: number[] = [];

  const winUsd: number[] = [];
  const lossUsd: number[] = [];

  let grossProfit = 0;
  let grossLossAbs = 0;

  let totalPnL = 0;

  for (const r of rows) {
    const entry = safeNum(r.entry_price);
    const exit = safeNum(r.exit_price);

    if (entry === null || exit === null || entry <= 0) continue;

    // Quantity resolver (edit here if your schema uses a different field name)
    const qty =
      safeNum(r.shares) ??
      safeNum(r.quantity) ??
      safeNum(r.position_size) ??
      0;

    const fees = (safeNum(r.entry_fee) ?? 0) + (safeNum(r.exit_fee) ?? 0);
    const grossUsd = (exit - entry) * (qty ?? 0);
    const usd = grossUsd - fees;
    const positionCost = entry * (qty ?? 0);
    const pct = positionCost > 0 ? usd / positionCost : (exit - entry) / entry;

    totalPnL += usd;

    if (pct > 0) {
      wins += 1;
      winPcts.push(pct);
      winUsd.push(usd);
      grossProfit += usd;
    } else if (pct < 0) {
      losses += 1;
      lossPcts.push(pct);
      lossUsd.push(usd);
      grossLossAbs += Math.abs(usd);
    } else {
      // flat trade: count as neither win nor loss
    }
  }

  const effectiveTrades = wins + losses; // excludes flat + invalid rows
  const denomTrades = effectiveTrades > 0 ? effectiveTrades : 1;

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const avgWinPct = avg(winPcts);
  const avgLossPct = avg(lossPcts); // negative
  const avgWinUsd = avg(winUsd);
  const avgLossUsd = avg(lossUsd);  // negative

  const winRate = effectiveTrades ? wins / effectiveTrades : 0;

  const profitFactor =
    grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? Infinity : null);

  const expectancyUsd = effectiveTrades ? totalPnL / denomTrades : 0;

  return {
    trades: effectiveTrades,

    wins,
    losses,
    winRate,

    avgWinPct,
    avgLossPct,

    avgWinUsd,
    avgLossUsd,

    grossProfit,
    grossLossAbs,

    profitFactor,
    expectancyUsd,
  };
}

export function formatPct(x: number): string {
  const v = x * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export function formatUsd(x: number): string {
  const sign = x > 0 ? "+" : "";
  return `${sign}$${Math.abs(x).toFixed(2)}`;
}
