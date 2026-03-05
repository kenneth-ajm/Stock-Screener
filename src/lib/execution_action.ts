import type { PortfolioCapacity } from "@/lib/portfolio_capacity";

export type PortfolioAwareAction = "BUY_NOW" | "WAIT" | "SKIP";

type ScanInput = {
  signal: "BUY" | "WATCH" | "AVOID";
  entry: number;
  stop: number;
  confidence?: number | null;
  rank_score?: number | null;
};

export type ExecutionActionResult = {
  action: PortfolioAwareAction;
  action_reason: string;
  sizing: {
    shares: number;
    est_cost: number;
    risk_per_share: number;
    risk_budget: number;
  };
};

function toNum(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function computePortfolioAwareAction(
  row: ScanInput,
  capacity: PortfolioCapacity | null,
  fees = 0
): ExecutionActionResult {
  const entry = toNum(row.entry, 0);
  const stop = toNum(row.stop, 0);
  const riskPerShare = entry - stop;

  if (row.signal === "AVOID") {
    return {
      action: "SKIP",
      action_reason: "Signal is AVOID",
      sizing: { shares: 0, est_cost: 0, risk_per_share: riskPerShare, risk_budget: 0 },
    };
  }
  if (row.signal !== "BUY") {
    return {
      action: "WAIT",
      action_reason: "Signal is not BUY",
      sizing: { shares: 0, est_cost: 0, risk_per_share: riskPerShare, risk_budget: 0 },
    };
  }
  if (!capacity) {
    return {
      action: "WAIT",
      action_reason: "Portfolio capacity unavailable",
      sizing: { shares: 0, est_cost: 0, risk_per_share: riskPerShare, risk_budget: 0 },
    };
  }
  if (capacity.slots_left <= 0) {
    return {
      action: "WAIT",
      action_reason: "No position slots",
      sizing: { shares: 0, est_cost: 0, risk_per_share: riskPerShare, risk_budget: 0 },
    };
  }
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(riskPerShare) || riskPerShare <= 0) {
    return {
      action: "SKIP",
      action_reason: "Invalid stop/entry",
      sizing: { shares: 0, est_cost: 0, risk_per_share: riskPerShare, risk_budget: 0 },
    };
  }

  const riskPerTradeDecimal =
    capacity.risk_per_trade > 1 ? capacity.risk_per_trade / 100 : capacity.risk_per_trade;
  const riskBudget = capacity.portfolio_value * riskPerTradeDecimal;
  const shares = Math.floor(riskBudget / riskPerShare);
  if (shares <= 0) {
    return {
      action: "SKIP",
      action_reason: "Risk budget too small",
      sizing: { shares: 0, est_cost: 0, risk_per_share: riskPerShare, risk_budget: riskBudget },
    };
  }

  const estCost = shares * entry + Math.max(0, fees);
  if (estCost > capacity.cash_available) {
    return {
      action: "WAIT",
      action_reason: "Insufficient cash",
      sizing: { shares, est_cost: estCost, risk_per_share: riskPerShare, risk_budget: riskBudget },
    };
  }

  return {
    action: "BUY_NOW",
    action_reason: "Capacity available",
    sizing: { shares, est_cost: estCost, risk_per_share: riskPerShare, risk_budget: riskBudget },
  };
}

