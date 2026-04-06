import type { PortfolioAwareAction } from "@/lib/execution_action";
import type { CandidateState } from "@/lib/idea_dossier";
import type { PortfolioCapacity } from "@/lib/portfolio_capacity";

export type PortfolioFitState =
  | "GOOD_FIT"
  | "ALREADY_HELD"
  | "CAPACITY_LIMITED"
  | "CROWDED"
  | "REVIEW";

export type PortfolioFitRowInput = {
  symbol: string;
  industry_group?: string | null;
  theme?: string | null;
  candidate_state?: CandidateState | string | null;
  action?: PortfolioAwareAction | string | null;
  action_reason?: string | null;
  sizing?: {
    shares?: number | null;
    est_cost?: number | null;
    limiting_factor?: "risk" | "cash" | "portfolio_cap" | "none" | null;
  } | null;
};

export type HeldPositionContext = {
  symbol: string;
  strategy_version?: string | null;
  industry_group?: string | null;
  theme?: string | null;
};

export type PortfolioFitResult = {
  fit_state: PortfolioFitState;
  fit_label: string;
  fit_score: number;
  summary: string;
  blockers: string[];
  watch_items: string[];
  already_held: boolean;
  open_positions_count: number;
  same_industry_count: number;
  same_theme_count: number;
  cash_available: number;
  slots_left: number;
  estimated_cost: number | null;
};

export type PortfolioFitSummary = {
  counts: {
    good_fit: number;
    already_held: number;
    capacity_limited: number;
    crowded: number;
    review: number;
  };
  best_fits: Array<{
    symbol: string;
    fit_state: PortfolioFitState;
    fit_label: string;
    summary: string;
  }>;
  overlap_summary: Array<{ label: string; count: number }>;
};

type PortfolioFitContext = {
  held_positions: HeldPositionContext[];
  capacity: PortfolioCapacity | null;
};

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeLabel(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function statePriority(candidateState: string | null | undefined) {
  switch (candidateState) {
    case "ACTIONABLE_TODAY":
      return 4;
    case "NEAR_ENTRY":
      return 3;
    case "QUALITY_WATCH":
      return 2;
    case "EXTENDED_LEADER":
      return 1;
    default:
      return 0;
  }
}

function fitLabel(state: PortfolioFitState) {
  switch (state) {
    case "GOOD_FIT":
      return "Good Fit";
    case "ALREADY_HELD":
      return "Already Held";
    case "CAPACITY_LIMITED":
      return "Capacity Limited";
    case "CROWDED":
      return "Crowded";
    default:
      return "Review";
  }
}

function fitStateScore(state: PortfolioFitState) {
  switch (state) {
    case "GOOD_FIT":
      return 5;
    case "REVIEW":
      return 4;
    case "CROWDED":
      return 3;
    case "CAPACITY_LIMITED":
      return 2;
    case "ALREADY_HELD":
      return 1;
    default:
      return 0;
  }
}

export function buildPortfolioFit(row: PortfolioFitRowInput, context: PortfolioFitContext): PortfolioFitResult {
  const symbol = normalizeLabel(row.symbol).toUpperCase();
  const heldPositions = Array.isArray(context.held_positions) ? context.held_positions : [];
  const capacity = context.capacity ?? null;
  const industryGroup = normalizeLabel(row.industry_group);
  const theme = normalizeLabel(row.theme);
  const sameSymbolCount = heldPositions.filter((position) => normalizeLabel(position.symbol).toUpperCase() === symbol).length;
  const sameIndustryCount =
    industryGroup.length === 0
      ? 0
      : heldPositions.filter((position) => normalizeLabel(position.industry_group) === industryGroup).length;
  const sameThemeCount =
    theme.length === 0 ? 0 : heldPositions.filter((position) => normalizeLabel(position.theme) === theme).length;
  const cashAvailable = Number(capacity?.cash_available ?? 0);
  const slotsLeft = Number(capacity?.slots_left ?? 0);
  const estimatedCost = typeof row.sizing?.est_cost === "number" && Number.isFinite(row.sizing.est_cost)
    ? row.sizing.est_cost
    : null;
  const limitingFactor = row.sizing?.limiting_factor ?? null;
  const alreadyHeld = sameSymbolCount > 0;
  const cashLimited =
    limitingFactor === "cash" ||
    /cash/i.test(String(row.action_reason ?? "")) ||
    (estimatedCost != null && cashAvailable > 0 && estimatedCost > cashAvailable);
  const slotLimited = /slot/i.test(String(row.action_reason ?? "")) || slotsLeft <= 0;
  const crowded = sameIndustryCount >= 2 || sameThemeCount >= 2;
  const blockers: string[] = [];
  const watchItems: string[] = [];

  if (alreadyHeld) blockers.push("Already holding this symbol");
  if (cashLimited) blockers.push("Available cash is tight for this ticket");
  if (slotLimited) blockers.push("No free portfolio slots");
  if (sameIndustryCount >= 2 && industryGroup) blockers.push(`Existing ${industryGroup} exposure is already stacked`);
  if (sameThemeCount >= 2 && theme) blockers.push(`Existing ${theme} theme exposure is already stacked`);

  if (cashLimited) watchItems.push("Free cash or reduce size before adding");
  if (slotLimited) watchItems.push("Free a slot before adding");
  if (sameIndustryCount >= 2 && industryGroup) watchItems.push(`Review ${industryGroup} concentration`);
  if (sameThemeCount >= 2 && theme) watchItems.push(`Review ${theme} theme overlap`);

  let fitState: PortfolioFitState = "REVIEW";
  if (alreadyHeld) {
    fitState = "ALREADY_HELD";
  } else if (cashLimited || slotLimited) {
    fitState = "CAPACITY_LIMITED";
  } else if (crowded) {
    fitState = "CROWDED";
  } else if (
    (row.action === "BUY_NOW" || row.candidate_state === "ACTIONABLE_TODAY" || row.candidate_state === "NEAR_ENTRY") &&
    !alreadyHeld &&
    !cashLimited &&
    !slotLimited
  ) {
    fitState = "GOOD_FIT";
  }

  const fitScore =
    fitStateScore(fitState) * 10 +
    statePriority(String(row.candidate_state ?? null)) * 4 +
    (row.action === "BUY_NOW" ? 3 : row.action === "WAIT" ? 1 : 0) -
    Math.min(4, blockers.length);

  const summaryBits: string[] = [];
  if (fitState === "GOOD_FIT") {
    summaryBits.push("Fits current cash and slot capacity.");
  } else if (fitState === "ALREADY_HELD") {
    summaryBits.push("This symbol is already in the portfolio.");
  } else if (fitState === "CAPACITY_LIMITED") {
    summaryBits.push("Portfolio capacity is the main constraint.");
  } else if (fitState === "CROWDED") {
    summaryBits.push("Existing exposure is already clustered.");
  } else {
    summaryBits.push("Worth review, but not a clean add yet.");
  }
  if (sameIndustryCount > 0 && industryGroup) summaryBits.push(`${sameIndustryCount} current holding(s) already sit in ${industryGroup}.`);
  if (sameThemeCount > 0 && theme) summaryBits.push(`${sameThemeCount} current holding(s) already align with ${theme}.`);
  if (cashLimited && estimatedCost != null && cashAvailable > 0) {
    summaryBits.push(`Estimated cost ${estimatedCost.toFixed(0)} exceeds cash ${cashAvailable.toFixed(0)}.`);
  }

  return {
    fit_state: fitState,
    fit_label: fitLabel(fitState),
    fit_score: Math.round(fitScore * 10) / 10,
    summary: summaryBits.join(" "),
    blockers: unique(blockers),
    watch_items: unique(watchItems),
    already_held: alreadyHeld,
    open_positions_count: heldPositions.length,
    same_industry_count: sameIndustryCount,
    same_theme_count: sameThemeCount,
    cash_available: cashAvailable,
    slots_left: slotsLeft,
    estimated_cost: estimatedCost,
  };
}

function overlapCounts(heldPositions: HeldPositionContext[]) {
  const counts = new Map<string, number>();
  for (const position of heldPositions) {
    const industry = normalizeLabel(position.industry_group);
    const theme = normalizeLabel(position.theme);
    if (industry) counts.set(industry, (counts.get(industry) ?? 0) + 1);
    if (theme) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5);
}

export function summarizePortfolioFit(
  rows: Array<{ symbol: string; portfolio_fit?: PortfolioFitResult | null }>,
  heldPositions: HeldPositionContext[]
): PortfolioFitSummary {
  const counts = {
    good_fit: 0,
    already_held: 0,
    capacity_limited: 0,
    crowded: 0,
    review: 0,
  };

  const bestFits = rows
    .map((row) => ({ symbol: row.symbol, fit: row.portfolio_fit ?? null }))
    .filter((row): row is { symbol: string; fit: PortfolioFitResult } => !!row.fit)
    .sort((a, b) => {
      if (b.fit.fit_score !== a.fit.fit_score) return b.fit.fit_score - a.fit.fit_score;
      return a.symbol.localeCompare(b.symbol);
    });

  for (const row of bestFits) {
    switch (row.fit.fit_state) {
      case "GOOD_FIT":
        counts.good_fit += 1;
        break;
      case "ALREADY_HELD":
        counts.already_held += 1;
        break;
      case "CAPACITY_LIMITED":
        counts.capacity_limited += 1;
        break;
      case "CROWDED":
        counts.crowded += 1;
        break;
      default:
        counts.review += 1;
        break;
    }
  }

  return {
    counts,
    best_fits: bestFits.slice(0, 5).map((row) => ({
      symbol: row.symbol,
      fit_state: row.fit.fit_state,
      fit_label: row.fit.fit_label,
      summary: row.fit.summary,
    })),
    overlap_summary: overlapCounts(heldPositions),
  };
}
