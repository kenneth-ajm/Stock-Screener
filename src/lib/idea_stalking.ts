export type StalkingRowInput = {
  symbol: string;
  candidate_state?: string | null;
  candidate_state_label?: string | null;
  signal: "BUY" | "WATCH" | "AVOID";
  quality_score?: number | null;
  blockers?: string[] | null;
  change_status?: "NEW" | "UPGRADED" | "UNCHANGED" | "DOWNGRADED" | null;
  transition_plan?: {
    next_action?: string | null;
    triggers_to_buy?: string[] | null;
    strengths_now?: string[] | null;
  } | null;
  leadership_context?: {
    state?: "LEADING" | "IMPROVING" | "WEAK" | "UNKNOWN" | null;
    label?: string | null;
  } | null;
  portfolio_fit?: {
    fit_state?: "GOOD_FIT" | "ALREADY_HELD" | "CAPACITY_LIMITED" | "CROWDED" | "REVIEW" | null;
    fit_label?: string | null;
  } | null;
};

export type StalkingCandidate = {
  symbol: string;
  stalking_score: number;
  stalking_label: string;
  summary: string;
  next_trigger: string | null;
};

export type StalkingSummary = {
  ready_tomorrow: number;
  close_watch: number;
  blocked_by_market: number;
  blocked_by_capacity: number;
};

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function scoreCandidate(row: StalkingRowInput) {
  let score = 0;
  if (row.candidate_state === "NEAR_ENTRY") score += 45;
  else if (row.candidate_state === "QUALITY_WATCH") score += 32;
  else if (row.candidate_state === "EXTENDED_LEADER") score += 18;
  else if (row.candidate_state === "ACTIONABLE_TODAY") score += 22;

  const quality = typeof row.quality_score === "number" ? row.quality_score : 0;
  score += Math.min(25, quality / 4);

  if (row.change_status === "NEW") score += 10;
  if (row.change_status === "UPGRADED") score += 8;
  if (row.leadership_context?.state === "LEADING") score += 8;
  if (row.leadership_context?.state === "IMPROVING") score += 5;
  if (row.portfolio_fit?.fit_state === "GOOD_FIT") score += 7;
  if (row.portfolio_fit?.fit_state === "REVIEW") score += 2;

  const blockers = Array.isArray(row.blockers) ? row.blockers : [];
  score -= Math.min(20, blockers.length * 4);
  if (blockers.some((item) => /Market regime/i.test(item))) score -= 5;
  if (blockers.some((item) => /cash|slot/i.test(item))) score -= 6;

  return Math.round(score * 10) / 10;
}

function stalkingLabel(row: StalkingRowInput) {
  if (row.candidate_state === "NEAR_ENTRY" && row.portfolio_fit?.fit_state === "GOOD_FIT") return "Tomorrow-ready";
  if (row.candidate_state === "QUALITY_WATCH") return "Close watch";
  if (row.candidate_state === "EXTENDED_LEADER") return "Wait for pullback";
  if (row.candidate_state === "BLOCKED") return "Blocked watch";
  return "Monitor";
}

export function buildStalkingQueue(rows: StalkingRowInput[]) {
  const candidates = rows
    .filter((row) => row.signal !== "AVOID")
    .map((row) => {
      const score = scoreCandidate(row);
      const triggers = unique(Array.isArray(row.transition_plan?.triggers_to_buy) ? row.transition_plan?.triggers_to_buy : []);
      const strengths = unique(Array.isArray(row.transition_plan?.strengths_now) ? row.transition_plan?.strengths_now : []);
      const summary =
        row.candidate_state === "NEAR_ENTRY"
          ? `Close to actionable. ${strengths[0] ?? "Setup quality is present."}`
          : row.candidate_state === "QUALITY_WATCH"
          ? `Worth stalking. ${triggers[0] ?? strengths[0] ?? "Needs one more improvement."}`
          : row.candidate_state === "EXTENDED_LEADER"
          ? `Leadership is present, but timing still needs a reset.`
          : `${row.candidate_state_label ?? row.candidate_state ?? "Monitor"} setup.`;
      return {
        symbol: row.symbol,
        stalking_score: score,
        stalking_label: stalkingLabel(row),
        summary,
        next_trigger: triggers[0] ?? null,
      } satisfies StalkingCandidate;
    })
    .sort((a, b) => {
      if (b.stalking_score !== a.stalking_score) return b.stalking_score - a.stalking_score;
      return a.symbol.localeCompare(b.symbol);
    });

  const summary: StalkingSummary = {
    ready_tomorrow: rows.filter(
      (row) =>
        row.candidate_state === "NEAR_ENTRY" &&
        (row.portfolio_fit?.fit_state === "GOOD_FIT" || row.portfolio_fit?.fit_state === "REVIEW")
    ).length,
    close_watch: rows.filter((row) => row.candidate_state === "QUALITY_WATCH").length,
    blocked_by_market: rows.filter((row) => (row.blockers ?? []).some((item) => /Market regime/i.test(item))).length,
    blocked_by_capacity: rows.filter((row) => (row.blockers ?? []).some((item) => /cash|slot/i.test(item))).length,
  };

  return {
    summary,
    queue: candidates.slice(0, 6),
  };
}
