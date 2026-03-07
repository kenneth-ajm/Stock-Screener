import type { SignalValue, RiskGrade } from "@/lib/signal_quality";

export type TradePrepState = "READY" | "REVIEW" | "BLOCKED";

export type TradeRiskLayerResult = {
  prep_state: TradePrepState;
  summary: string;
  ticket_candidate: {
    entry: number;
    stop: number;
    tp1: number;
    tp2: number;
    max_holding_days: number;
  };
  risk: {
    risk_per_share: number;
    stop_pct: number;
    tp1_pct: number;
    tp2_pct: number;
    rr_tp1: number;
    rr_tp2: number;
  };
  sizing_hint: {
    risk_budget_1pct: number;
    risk_budget_2pct: number;
    shares_at_1pct: number;
    shares_at_2pct: number;
    est_cost_at_2pct: number;
  };
  flags: string[];
};

export type TradeRiskLayerInput = {
  strategy_version: string;
  signal: SignalValue;
  quality_score: number;
  risk_grade: RiskGrade;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  confidence?: number | null;
  max_holding_days?: number | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function defaultMaxHoldingDays(strategyVersion: string) {
  return strategyVersion === "v1_trend_hold" ? 45 : 7;
}

export function buildTradeRiskLayer(input: TradeRiskLayerInput): TradeRiskLayerResult {
  const entry = toNum(input.entry) ?? 0;
  const stop = toNum(input.stop) ?? 0;
  const tp1 = toNum(input.tp1) ?? 0;
  const tp2 = toNum(input.tp2) ?? 0;
  const maxHoldingDays =
    (toNum(input.max_holding_days) && Number(input.max_holding_days) > 0
      ? Number(input.max_holding_days)
      : defaultMaxHoldingDays(input.strategy_version)) || defaultMaxHoldingDays(input.strategy_version);

  const riskPerShare = entry > 0 && stop > 0 ? entry - stop : 0;
  const stopPct = entry > 0 && stop > 0 ? ((entry - stop) / entry) * 100 : 0;
  const tp1Pct = entry > 0 && tp1 > 0 ? ((tp1 - entry) / entry) * 100 : 0;
  const tp2Pct = entry > 0 && tp2 > 0 ? ((tp2 - entry) / entry) * 100 : 0;
  const rrTp1 = riskPerShare > 0 ? (tp1 - entry) / riskPerShare : 0;
  const rrTp2 = riskPerShare > 0 ? (tp2 - entry) / riskPerShare : 0;

  const riskBudget1 = 1000;
  const riskBudget2 = 2000;
  const sharesAt1 = riskPerShare > 0 ? Math.floor(riskBudget1 / riskPerShare) : 0;
  const sharesAt2 = riskPerShare > 0 ? Math.floor(riskBudget2 / riskPerShare) : 0;

  const flags: string[] = [];
  if (!(entry > 0)) flags.push("invalid_entry");
  if (!(stop > 0) || !(stop < entry)) flags.push("invalid_stop");
  if (!(tp1 >= entry)) flags.push("invalid_tp1");
  if (!(tp2 >= entry)) flags.push("invalid_tp2");
  if (riskPerShare <= 0) flags.push("non_positive_risk_per_share");
  if (stopPct > 12) flags.push("stop_too_wide");
  if (rrTp1 < 1) flags.push("tp1_rr_below_1");

  let prepState: TradePrepState = "REVIEW";
  if (flags.some((f) => f.startsWith("invalid_") || f === "non_positive_risk_per_share")) {
    prepState = "BLOCKED";
  } else if (input.signal !== "BUY") {
    prepState = "REVIEW";
  } else if (input.quality_score >= 70 && input.risk_grade !== "D" && rrTp1 >= 1) {
    prepState = "READY";
  } else if (input.quality_score < 50 || input.risk_grade === "D") {
    prepState = "BLOCKED";
  }

  const summary =
    prepState === "READY"
      ? `Ticket ready: quality ${Math.round(input.quality_score)}/100, stop ${round2(stopPct)}%, RR1 ${round2(rrTp1)}.`
      : prepState === "BLOCKED"
      ? `Ticket blocked: ${flags.join(", ") || "low quality"}.`
      : `Ticket review: quality ${Math.round(input.quality_score)}/100, stop ${round2(stopPct)}%, RR1 ${round2(rrTp1)}.`;

  return {
    prep_state: prepState,
    summary,
    ticket_candidate: {
      entry: round2(entry),
      stop: round2(stop),
      tp1: round2(tp1),
      tp2: round2(tp2),
      max_holding_days: Math.round(clamp(maxHoldingDays, 1, 120)),
    },
    risk: {
      risk_per_share: round2(riskPerShare),
      stop_pct: round2(stopPct),
      tp1_pct: round2(tp1Pct),
      tp2_pct: round2(tp2Pct),
      rr_tp1: round2(rrTp1),
      rr_tp2: round2(rrTp2),
    },
    sizing_hint: {
      risk_budget_1pct: riskBudget1,
      risk_budget_2pct: riskBudget2,
      shares_at_1pct: sharesAt1,
      shares_at_2pct: sharesAt2,
      est_cost_at_2pct: round2(sharesAt2 * entry),
    },
    flags,
  };
}
