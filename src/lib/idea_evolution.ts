export type IdeaEvolutionState = "NEW" | "IMPROVING" | "STABLE" | "AT_RISK";

export type IdeaEvolutionInput = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  candidate_state?: string | null;
  change_status?: "NEW" | "UPGRADED" | "UNCHANGED" | "DOWNGRADED" | null;
  change_label?: string | null;
  prior_signal?: "BUY" | "WATCH" | "AVOID" | null;
  prior_quality_score?: number | null;
  prior_date?: string | null;
  quality_score?: number | null;
  quality_delta?: number | null;
  blockers?: string[] | null;
};

export type IdeaEvolutionContext = {
  state: IdeaEvolutionState;
  label: string;
  summary: string;
  key_change: string;
  watch_items: string[];
  momentum_score: number;
};

export type IdeaEvolutionSummary = {
  counts: {
    new: number;
    improving: number;
    stable: number;
    at_risk: number;
  };
  top_improvers: Array<{
    symbol: string;
    label: string;
    summary: string;
  }>;
  top_at_risk: Array<{
    symbol: string;
    label: string;
    summary: string;
  }>;
};

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function scoreSignal(signal: "BUY" | "WATCH" | "AVOID" | null | undefined) {
  switch (signal) {
    case "BUY":
      return 3;
    case "WATCH":
      return 2;
    default:
      return 1;
  }
}

function scoreCandidateState(state: string | null | undefined) {
  switch (state) {
    case "ACTIONABLE_TODAY":
      return 5;
    case "NEAR_ENTRY":
      return 4;
    case "QUALITY_WATCH":
      return 3;
    case "EXTENDED_LEADER":
      return 2;
    case "BLOCKED":
      return 1;
    default:
      return 0;
  }
}

function stateLabel(state: IdeaEvolutionState) {
  switch (state) {
    case "NEW":
      return "New setup";
    case "IMPROVING":
      return "Improving";
    case "AT_RISK":
      return "At risk";
    default:
      return "Stable";
  }
}

export function buildIdeaEvolution(input: IdeaEvolutionInput): IdeaEvolutionContext {
  const blockers = Array.isArray(input.blockers) ? input.blockers : [];
  const quality = typeof input.quality_score === "number" ? input.quality_score : null;
  const qualityDelta = typeof input.quality_delta === "number" ? input.quality_delta : null;
  const currentSignalScore = scoreSignal(input.signal);
  const priorSignalScore = scoreSignal(input.prior_signal);
  const candidateScore = scoreCandidateState(input.candidate_state);

  let state: IdeaEvolutionState = "STABLE";
  if (input.change_status === "NEW") {
    state = "NEW";
  } else if (input.change_status === "DOWNGRADED" || blockers.some((item) => /market regime|earnings|capacity|cash|slot/i.test(item))) {
    state = "AT_RISK";
  } else if (input.change_status === "UPGRADED" || (qualityDelta != null && qualityDelta >= 5)) {
    state = "IMPROVING";
  }

  const watchItems = unique([
    blockers.find((item) => /market regime/i.test(item)) ?? "",
    blockers.find((item) => /earnings/i.test(item)) ?? "",
    blockers.find((item) => /cash|slot|capacity/i.test(item)) ?? "",
    blockers.find((item) => /extended/i.test(item)) ?? "",
  ]).slice(0, 3);

  let keyChange = "No major change versus the prior scan.";
  if (state === "NEW") {
    keyChange = input.prior_date ? `New versus ${input.prior_date}.` : "New in the loaded set.";
  } else if (input.change_status === "UPGRADED") {
    if (input.prior_signal && input.prior_signal !== input.signal) {
      keyChange = `Signal improved from ${input.prior_signal} to ${input.signal}.`;
    } else if (qualityDelta != null) {
      keyChange = `Quality improved by ${qualityDelta > 0 ? "+" : ""}${qualityDelta.toFixed(1)}.`;
    } else {
      keyChange = "Setup improved versus the prior scan.";
    }
  } else if (input.change_status === "DOWNGRADED") {
    if (input.prior_signal && input.prior_signal !== input.signal) {
      keyChange = `Signal weakened from ${input.prior_signal} to ${input.signal}.`;
    } else if (qualityDelta != null) {
      keyChange = `Quality deteriorated by ${qualityDelta.toFixed(1)}.`;
    } else {
      keyChange = "Setup weakened versus the prior scan.";
    }
  } else if (qualityDelta != null && qualityDelta !== 0) {
    keyChange = `Quality is ${qualityDelta > 0 ? "up" : "down"} ${Math.abs(qualityDelta).toFixed(1)} versus the prior scan.`;
  }

  const summaryBits: string[] = [];
  if (state === "IMPROVING") {
    summaryBits.push("The setup is improving versus the prior scan.");
  } else if (state === "AT_RISK") {
    summaryBits.push("The setup is losing quality or facing a new blocker.");
  } else if (state === "NEW") {
    summaryBits.push("This name is newly surfaced in the current loaded set.");
  } else {
    summaryBits.push("The setup is broadly stable versus the prior scan.");
  }
  if (candidateScore >= 4) summaryBits.push("It is still relatively close to actionable.");
  else if (candidateScore <= 1) summaryBits.push("It is currently in a defensive state.");
  if (watchItems.length > 0) summaryBits.push(`Main watch: ${watchItems[0]}.`);

  const momentumScore = Math.round(
    ((state === "NEW" ? 14 : state === "IMPROVING" ? 18 : state === "AT_RISK" ? 6 : 10) +
      currentSignalScore * 3 +
      candidateScore * 4 +
      (quality != null ? Math.min(25, quality / 4) : 0) +
      (qualityDelta != null ? Math.max(-10, Math.min(10, qualityDelta)) : 0) -
      blockers.length * 2) * 10
  ) / 10;

  return {
    state,
    label: stateLabel(state),
    summary: summaryBits.join(" "),
    key_change: keyChange,
    watch_items: watchItems,
    momentum_score: momentumScore,
  };
}

export function summarizeIdeaEvolution(rows: Array<{ symbol: string; evolution_context?: IdeaEvolutionContext | null }>): IdeaEvolutionSummary {
  const counts = { new: 0, improving: 0, stable: 0, at_risk: 0 };
  const list = rows
    .map((row) => ({ symbol: row.symbol, context: row.evolution_context ?? null }))
    .filter((row): row is { symbol: string; context: IdeaEvolutionContext } => Boolean(row.context));

  for (const row of list) {
    switch (row.context.state) {
      case "NEW":
        counts.new += 1;
        break;
      case "IMPROVING":
        counts.improving += 1;
        break;
      case "AT_RISK":
        counts.at_risk += 1;
        break;
      default:
        counts.stable += 1;
        break;
    }
  }

  const topImprovers = [...list]
    .filter((row) => row.context.state === "NEW" || row.context.state === "IMPROVING")
    .sort((a, b) => b.context.momentum_score - a.context.momentum_score || a.symbol.localeCompare(b.symbol))
    .slice(0, 5)
    .map((row) => ({ symbol: row.symbol, label: row.context.label, summary: row.context.summary }));

  const topAtRisk = [...list]
    .filter((row) => row.context.state === "AT_RISK")
    .sort((a, b) => a.context.momentum_score - b.context.momentum_score || a.symbol.localeCompare(b.symbol))
    .slice(0, 5)
    .map((row) => ({ symbol: row.symbol, label: row.context.label, summary: row.context.summary }));

  return {
    counts,
    top_improvers: topImprovers,
    top_at_risk: topAtRisk,
  };
}
