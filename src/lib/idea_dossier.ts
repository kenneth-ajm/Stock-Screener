export type CandidateState =
  | "ACTIONABLE_TODAY"
  | "NEAR_ENTRY"
  | "QUALITY_WATCH"
  | "EXTENDED_LEADER"
  | "BLOCKED"
  | "AVOID";

export type IdeaDossier = {
  setup_type: string;
  candidate_state: CandidateState;
  candidate_state_label: string;
  blockers: string[];
  watch_items: string[];
  dossier_summary: string;
};

type IdeaDossierInput = {
  strategy_version: string;
  signal: "BUY" | "WATCH" | "AVOID";
  quality_score: number | null;
  quality_signal: "BUY" | "WATCH" | "AVOID" | null;
  quality_summary: string | null;
  action: "BUY_NOW" | "WAIT" | "SKIP";
  action_reason: string;
  trade_risk_layer?: {
    prep_state?: "READY" | "REVIEW" | "BLOCKED";
    flags?: string[];
  } | null;
  reason_summary?: string | null;
  reason_json?: Record<string, unknown> | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return null;
    current = current[key];
  }
  return current;
}

function checkOk(reasonJson: Record<string, unknown> | null | undefined, keys: string[]) {
  const checksValue = reasonJson && typeof reasonJson === "object" ? reasonJson.checks : null;
  const checks = Array.isArray(checksValue) ? checksValue : [];
  const wanted = new Set(keys.map((k) => String(k).toLowerCase()));
  for (const check of checks) {
    const row = isObject(check) ? check : null;
    const key = String(row?.key ?? row?.id ?? "").toLowerCase();
    if (!wanted.has(key)) continue;
    if (typeof row?.ok === "boolean") return row.ok;
  }
  return null;
}

function normalizeStrategyLabel(strategyVersion: string) {
  if (strategyVersion === "v1_trend_hold") return "Trend continuation";
  if (strategyVersion === "v1_sector_momentum") return "Sector leadership";
  if (strategyVersion === "quality_dip") return "Quality dip";
  return "Momentum swing";
}

function candidateStateLabel(state: CandidateState) {
  switch (state) {
    case "ACTIONABLE_TODAY":
      return "Actionable Today";
    case "NEAR_ENTRY":
      return "Near Entry";
    case "QUALITY_WATCH":
      return "Quality Watch";
    case "EXTENDED_LEADER":
      return "Extended Leader";
    case "BLOCKED":
      return "Blocked";
    default:
      return "Avoid";
  }
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function blockerLabel(blocker: string) {
  switch (blocker) {
    case "market_regime_block":
      return "Market regime not supportive";
    case "earnings_proximity_block":
      return "Earnings too close";
    case "relative_volume_block":
      return "Relative volume too weak";
    case "stop_too_wide":
      return "Stop too wide";
    case "tp1_rr_below_1":
      return "Reward/risk too thin";
    case "insufficient_cash":
      return "Insufficient cash";
    case "no_position_slots":
      return "No position slots";
    case "invalid_stop":
      return "Invalid stop";
    case "signal_not_buy":
      return "Signal not BUY";
    case "too_extended":
      return "Too extended";
    default:
      return blocker.replaceAll("_", " ");
  }
}

function watchItemForBlocker(blocker: string) {
  switch (blocker) {
    case "market_regime_block":
      return "Wait for SPY regime to improve";
    case "earnings_proximity_block":
      return "Revisit after the earnings window clears";
    case "relative_volume_block":
      return "Look for stronger participation and relative volume";
    case "stop_too_wide":
      return "Wait for a tighter stop structure";
    case "tp1_rr_below_1":
      return "Wait for better reward/risk";
    case "insufficient_cash":
      return "Free cash or reduce size";
    case "no_position_slots":
      return "Free a slot before adding";
    case "too_extended":
      return "Wait for a pullback into the buy zone";
    default:
      return "";
  }
}

function collectBlockers(input: IdeaDossierInput) {
  const blockers: string[] = [];
  const reasonJson = input.reason_json ?? null;
  const postFilters = getPath(reasonJson, ["post_strategy_filters", "blockers"]);
  if (Array.isArray(postFilters)) {
    for (const blocker of postFilters) {
      if (typeof blocker === "string") blockers.push(blocker);
    }
  }
  const directBlockers = getPath(reasonJson, ["filter_blockers"]);
  if (Array.isArray(directBlockers)) {
    for (const blocker of directBlockers) {
      if (typeof blocker === "string") blockers.push(blocker);
    }
  }

  const prepFlags = Array.isArray(input.trade_risk_layer?.flags) ? input.trade_risk_layer?.flags : [];
  for (const flag of prepFlags ?? []) {
    if (flag === "stop_too_wide" || flag === "tp1_rr_below_1" || flag === "invalid_stop") blockers.push(flag);
  }

  if (input.action === "WAIT" && /cash/i.test(input.action_reason)) blockers.push("insufficient_cash");
  if (input.action === "WAIT" && /slot/i.test(input.action_reason)) blockers.push("no_position_slots");
  if (input.action === "WAIT" && input.signal !== "BUY") blockers.push("signal_not_buy");

  const notExtended = checkOk(reasonJson, ["not_too_extended", "extension_buy", "extension_watch"]);
  if (notExtended === false) blockers.push("too_extended");

  return unique(blockers);
}

export function buildIdeaDossier(input: IdeaDossierInput): IdeaDossier {
  const setupType = normalizeStrategyLabel(input.strategy_version);
  const blockers = collectBlockers(input);
  const watchItems = unique(blockers.map(watchItemForBlocker).filter(Boolean));
  const prepState = input.trade_risk_layer?.prep_state ?? "REVIEW";
  const qualityScore = typeof input.quality_score === "number" && Number.isFinite(input.quality_score)
    ? input.quality_score
    : null;

  let candidateState: CandidateState = "QUALITY_WATCH";

  if (input.signal === "AVOID" || input.quality_signal === "AVOID") {
    candidateState = blockers.length > 0 ? "BLOCKED" : "AVOID";
  } else if (input.action === "BUY_NOW" && prepState === "READY" && blockers.length === 0) {
    candidateState = "ACTIONABLE_TODAY";
  } else if (blockers.includes("too_extended")) {
    candidateState = "EXTENDED_LEADER";
  } else if (input.signal === "BUY" && prepState !== "BLOCKED") {
    candidateState = "NEAR_ENTRY";
  } else if (prepState === "BLOCKED" || blockers.length > 0) {
    candidateState = "BLOCKED";
  } else if ((qualityScore ?? 0) >= 65 || input.signal === "WATCH") {
    candidateState = "QUALITY_WATCH";
  }

  const stateLabel = candidateStateLabel(candidateState);
  const summaryBits: string[] = [];
  summaryBits.push(`${stateLabel}: ${setupType.toLowerCase()}.`);
  if (input.reason_summary) summaryBits.push(input.reason_summary.trim());
  if (input.quality_summary) summaryBits.push(input.quality_summary.trim());
  if (blockers.length > 0) {
    summaryBits.push(`Main blockers: ${blockers.slice(0, 2).map(blockerLabel).join(", ")}.`);
  } else if (candidateState === "ACTIONABLE_TODAY") {
    summaryBits.push("No major blockers from quality, timing, or trade-prep layers.");
  }
  if (watchItems.length > 0) {
    summaryBits.push(`Watch for: ${watchItems.slice(0, 2).join("; ")}.`);
  }

  return {
    setup_type: setupType,
    candidate_state: candidateState,
    candidate_state_label: stateLabel,
    blockers: blockers.map(blockerLabel),
    watch_items: watchItems,
    dossier_summary: summaryBits.join(" "),
  };
}
