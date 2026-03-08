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
    shares_by_risk: number;
    shares_by_cash: number;
    shares_by_portfolio_cap: number | null;
    limiting_factor: "risk" | "cash" | "portfolio_cap" | "none";
    sizing_mode: "cash_only";
  };
};

function toNum(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function emptySizing(riskPerShare: number, riskBudget = 0): ExecutionActionResult["sizing"] {
  return {
    shares: 0,
    est_cost: 0,
    risk_per_share: riskPerShare,
    risk_budget: riskBudget,
    shares_by_risk: 0,
    shares_by_cash: 0,
    shares_by_portfolio_cap: null,
    limiting_factor: "none",
    sizing_mode: "cash_only",
  };
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
      sizing: emptySizing(riskPerShare, 0),
    };
  }
  if (row.signal !== "BUY") {
    return {
      action: "WAIT",
      action_reason: "Signal is not BUY",
      sizing: emptySizing(riskPerShare, 0),
    };
  }
  if (!capacity) {
    return {
      action: "WAIT",
      action_reason: "Portfolio capacity unavailable",
      sizing: emptySizing(riskPerShare, 0),
    };
  }
  if (capacity.slots_left <= 0) {
    return {
      action: "WAIT",
      action_reason: "No position slots",
      sizing: emptySizing(riskPerShare, 0),
    };
  }
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(riskPerShare) || riskPerShare <= 0) {
    return {
      action: "SKIP",
      action_reason: "Invalid stop/entry",
      sizing: emptySizing(riskPerShare, 0),
    };
  }

  const riskPerTradeDecimal =
    capacity.risk_per_trade > 1 ? capacity.risk_per_trade / 100 : capacity.risk_per_trade;
  const riskBudget = capacity.portfolio_value * riskPerTradeDecimal;
  const sharesByRisk = Math.max(0, Math.floor(riskBudget / riskPerShare));
  const sharesByCash = Math.max(0, Math.floor(capacity.cash_available / entry));
  const maxPositionCostRaw = toNum((capacity as any)?.max_position_cost, 0);
  const sharesByPortfolioCap = maxPositionCostRaw > 0 ? Math.max(0, Math.floor(maxPositionCostRaw / entry)) : null;
  const limitCandidates = [sharesByRisk, sharesByCash, ...(sharesByPortfolioCap != null ? [sharesByPortfolioCap] : [])];
  const shares = Math.max(0, Math.min(...limitCandidates));
  const limitingFactor: ExecutionActionResult["sizing"]["limiting_factor"] =
    sharesByPortfolioCap != null && shares === sharesByPortfolioCap
      ? "portfolio_cap"
      : shares === sharesByCash
      ? "cash"
      : shares === sharesByRisk
      ? "risk"
      : "none";

  if (shares <= 0) {
    return {
      action: "SKIP",
      action_reason: "Risk budget too small",
      sizing: {
        ...emptySizing(riskPerShare, riskBudget),
        shares_by_risk: sharesByRisk,
        shares_by_cash: sharesByCash,
        shares_by_portfolio_cap: sharesByPortfolioCap,
        limiting_factor: limitingFactor,
      },
    };
  }

  const estCost = shares * entry + Math.max(0, fees);
  if (sharesByCash <= 0 || estCost > capacity.cash_available) {
    return {
      action: "WAIT",
      action_reason: "Insufficient cash",
      sizing: {
        shares,
        est_cost: estCost,
        risk_per_share: riskPerShare,
        risk_budget: riskBudget,
        shares_by_risk: sharesByRisk,
        shares_by_cash: sharesByCash,
        shares_by_portfolio_cap: sharesByPortfolioCap,
        limiting_factor: sharesByCash <= 0 ? "cash" : limitingFactor,
        sizing_mode: "cash_only",
      },
    };
  }

  return {
    action: "BUY_NOW",
    action_reason: "Capacity available",
    sizing: {
      shares,
      est_cost: estCost,
      risk_per_share: riskPerShare,
      risk_budget: riskBudget,
      shares_by_risk: sharesByRisk,
      shares_by_cash: sharesByCash,
      shares_by_portfolio_cap: sharesByPortfolioCap,
      limiting_factor: limitingFactor,
      sizing_mode: "cash_only",
    },
  };
}
