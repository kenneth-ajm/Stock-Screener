export type DailyRecommendationState = "READY_NOW" | "WAIT_FOR_TRIGGER" | "RESEARCH" | "PASS";

export type DailyRecommendationInput = {
  signal: "BUY" | "WATCH" | "AVOID";
  action?: "BUY_NOW" | "WAIT" | "SKIP" | null;
  candidate_state?: string | null;
  quality_score?: number | null;
  risk_grade?: "A" | "B" | "C" | "D" | null;
  trade_prep_state?: "READY" | "REVIEW" | "BLOCKED" | null;
  setup_type?: string | null;
  blockers?: string[] | null;
  triggers_to_buy?: string[] | null;
  leadership_state?: "LEADING" | "IMPROVING" | "WEAK" | "UNKNOWN" | null;
};

export type DailyRecommendation = {
  state: DailyRecommendationState;
  label: string;
  headline: string;
  next_step: string;
  selection_label: "Strong candidate" | "Developing candidate" | "Weak candidate";
  timing_label: "Trigger confirmed" | "Near trigger" | "No valid trigger";
  risk_label: "Risk clear" | "Review risk" | "Risk blocked";
};

function first(items: string[] | null | undefined) {
  return Array.isArray(items) ? items.find((item) => Boolean(String(item ?? "").trim())) ?? null : null;
}

function hardFailure(blockers: string[]) {
  return blockers.some((blocker) =>
    /invalid stop|invalid entry|below sma200|liquidity|broken trend|risk grade d|defensive state/i.test(blocker)
  );
}

/**
 * Converts the scanner's detailed evidence into one decision vocabulary.
 * This does not promote or mutate the underlying cached signal.
 */
export function buildDailyRecommendation(input: DailyRecommendationInput): DailyRecommendation {
  const quality = Number.isFinite(Number(input.quality_score)) ? Number(input.quality_score) : 0;
  const blockers = Array.isArray(input.blockers) ? input.blockers.filter(Boolean) : [];
  const trigger = first(input.triggers_to_buy);
  const candidateState = String(input.candidate_state ?? "").toUpperCase();
  const leadership = String(input.leadership_state ?? "UNKNOWN").toUpperCase();
  const selectionLabel =
    quality >= 70 && leadership !== "WEAK"
      ? "Strong candidate"
      : quality >= 50 || leadership === "LEADING" || leadership === "IMPROVING"
        ? "Developing candidate"
        : "Weak candidate";
  const riskLabel =
    input.trade_prep_state === "BLOCKED" || hardFailure(blockers) || input.risk_grade === "D"
      ? "Risk blocked"
      : input.trade_prep_state === "READY" && blockers.length === 0
        ? "Risk clear"
        : "Review risk";

  if (
    input.signal === "BUY" &&
    input.action === "BUY_NOW" &&
    input.trade_prep_state === "READY" &&
    riskLabel !== "Risk blocked"
  ) {
    return {
      state: "READY_NOW",
      label: "Ready now",
      headline: `${input.setup_type ?? "The setup"} has a confirmed entry and an executable risk plan.`,
      next_step: "Open the ticket, verify the current price is still in zone, then size from the chart stop.",
      selection_label: selectionLabel,
      timing_label: "Trigger confirmed",
      risk_label: riskLabel,
    };
  }

  if (
    input.signal === "BUY" ||
    candidateState === "ACTIONABLE_TODAY" ||
    candidateState === "NEAR_ENTRY"
  ) {
    return {
      state: "WAIT_FOR_TRIGGER",
      label: "Wait for trigger",
      headline: trigger ?? first(blockers) ?? "The candidate is close, but the entry is not fully confirmed.",
      next_step: trigger ?? "Wait for price and volume to confirm the planned entry without chasing extension.",
      selection_label: selectionLabel,
      timing_label: "Near trigger",
      risk_label: riskLabel,
    };
  }

  if (
    input.signal === "WATCH" ||
    candidateState === "QUALITY_WATCH" ||
    candidateState === "EXTENDED_LEADER" ||
    quality >= 55
  ) {
    return {
      state: "RESEARCH",
      label: "Research",
      headline: first(blockers) ?? trigger ?? "The stock is worth monitoring, but does not have a valid entry yet.",
      next_step: trigger ?? "Keep it on the watchlist and wait for a constructive setup or renewed demand.",
      selection_label: selectionLabel,
      timing_label: "No valid trigger",
      risk_label: riskLabel,
    };
  }

  return {
    state: "PASS",
    label: "Pass",
    headline: first(blockers) ?? "The current daily setup does not justify new capital.",
    next_step: "Do not force an entry; reassess only after the trend or setup materially improves.",
    selection_label: selectionLabel,
    timing_label: "No valid trigger",
    risk_label: riskLabel,
  };
}
