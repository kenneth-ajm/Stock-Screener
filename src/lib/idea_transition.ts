import type { CandidateState } from "@/lib/idea_dossier";
import type { PortfolioFitResult } from "@/lib/portfolio_fit";

export type IdeaTransitionPlan = {
  summary: string;
  next_action: string;
  triggers_to_buy: string[];
  strengths_now: string[];
  invalidation_watch: string[];
};

type IdeaTransitionInput = {
  strategy_version: string;
  signal: "BUY" | "WATCH" | "AVOID";
  action?: "BUY_NOW" | "WAIT" | "SKIP" | null;
  action_reason?: string | null;
  candidate_state?: CandidateState | string | null;
  blockers?: string[] | null;
  watch_items?: string[] | null;
  symbol_facts?: {
    relative_volume?: number | null;
    above_sma50?: boolean | null;
    above_sma200?: boolean | null;
    trend_state?: string | null;
    extension_state?: string | null;
    liquidity_state?: string | null;
    volatility_state?: string | null;
    drop_from_30bar_high_pct?: number | null;
  } | null;
  portfolio_fit?: PortfolioFitResult | null;
};

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function labelStrategy(strategyVersion: string) {
  if (strategyVersion === "v1_trend_hold") return "trend hold";
  if (strategyVersion === "v1_sector_momentum") return "sector momentum";
  if (strategyVersion === "quality_dip") return "quality dip";
  return "momentum swing";
}

export function buildIdeaTransitionPlan(input: IdeaTransitionInput): IdeaTransitionPlan {
  const blockers = Array.isArray(input.blockers) ? input.blockers : [];
  const watchItems = Array.isArray(input.watch_items) ? input.watch_items : [];
  const facts = input.symbol_facts ?? null;
  const fit = input.portfolio_fit ?? null;
  const triggers: string[] = [];
  const strengths: string[] = [];
  const invalidations: string[] = [];

  if (input.action === "BUY_NOW" && input.candidate_state === "ACTIONABLE_TODAY" && fit?.fit_state === "GOOD_FIT") {
    triggers.push("Already buy-ready under current rules");
  }
  if (blockers.some((item) => /Market regime/i.test(item))) {
    triggers.push("SPY regime needs to stay supportive");
  }
  if (blockers.some((item) => /Relative volume/i.test(item))) {
    triggers.push("Relative volume needs to confirm on the next move");
  }
  if (blockers.some((item) => /Too extended/i.test(item))) {
    triggers.push("Price needs to pull back into the buy zone");
  }
  if (blockers.some((item) => /Signal not BUY/i.test(item))) {
    triggers.push("Core setup needs to upgrade from WATCH to BUY");
  }
  if (blockers.some((item) => /Reward\/risk/i.test(item))) {
    triggers.push("Reward/risk needs to improve versus the current stop");
  }
  if (fit?.fit_state === "CAPACITY_LIMITED") {
    triggers.push("Free cash or slots before adding");
  }
  if (fit?.fit_state === "CROWDED") {
    triggers.push("Reduce existing exposure in the same theme or industry first");
  }
  if (fit?.fit_state === "ALREADY_HELD") {
    triggers.push("Treat as an add-on only if the existing position plan allows it");
  }
  if (facts?.above_sma200 === false) {
    triggers.push("Reclaim SMA200 before treating this as actionable");
  } else if (facts?.above_sma50 === false) {
    triggers.push("Reclaim SMA50 to improve timing quality");
  }
  if (
    typeof facts?.drop_from_30bar_high_pct === "number" &&
    facts.drop_from_30bar_high_pct > 0 &&
    facts.drop_from_30bar_high_pct < 3 &&
    input.strategy_version === "quality_dip"
  ) {
    triggers.push("Wait for a deeper pullback into the preferred dip zone");
  }

  if (facts?.above_sma200) strengths.push("Stock is above SMA200");
  if (facts?.above_sma50) strengths.push("Stock is above SMA50");
  if (facts?.trend_state === "strong_uptrend") strengths.push("Trend structure is still strong");
  if (facts?.extension_state === "pullback") strengths.push("Pullback is in a healthier reset zone");
  if (facts?.liquidity_state === "institutional" || facts?.liquidity_state === "liquid") {
    strengths.push("Liquidity is strong enough for disciplined sizing");
  }
  if (typeof facts?.relative_volume === "number" && facts.relative_volume >= 1.2) {
    strengths.push("Relative volume is supportive");
  }
  if (fit?.fit_state === "GOOD_FIT") strengths.push("Portfolio capacity currently supports the trade");
  if (input.candidate_state === "NEAR_ENTRY") strengths.push("Setup is close to actionable");
  if (input.candidate_state === "QUALITY_WATCH") strengths.push("Underlying setup quality is worth monitoring");

  if (facts?.above_sma200 === false) invalidations.push("Staying below SMA200 keeps the setup defensive");
  if (blockers.some((item) => /Earnings/i.test(item))) invalidations.push("Earnings window can override an otherwise decent setup");
  if (facts?.volatility_state === "high") invalidations.push("Volatility is elevated; wider stops can distort sizing");
  if (fit?.fit_state === "CROWDED") invalidations.push("Adding more overlap may overconcentrate the portfolio");
  if (fit?.fit_state === "CAPACITY_LIMITED") invalidations.push("Insufficient cash or slots can force poor sizing");

  const resolvedTriggers = unique([...triggers, ...watchItems]).slice(0, 4);
  const resolvedStrengths = unique(strengths).slice(0, 4);
  const resolvedInvalidations = unique(invalidations).slice(0, 4);

  const nextAction =
    input.action === "BUY_NOW" && fit?.fit_state === "GOOD_FIT"
      ? "Ready to plan or paper trade now"
      : resolvedTriggers[0] ?? `Keep stalking this ${labelStrategy(input.strategy_version)} setup`;

  const summary =
    input.action === "BUY_NOW" && fit?.fit_state === "GOOD_FIT"
      ? "This setup is currently aligned on quality, timing, and portfolio fit."
      : resolvedTriggers.length > 0
      ? `Closest upgrade path: ${resolvedTriggers[0]}.`
      : `No single blocker dominates; keep monitoring this ${labelStrategy(input.strategy_version)} setup.`;

  return {
    summary,
    next_action: nextAction,
    triggers_to_buy: resolvedTriggers,
    strengths_now: resolvedStrengths,
    invalidation_watch: resolvedInvalidations,
  };
}
