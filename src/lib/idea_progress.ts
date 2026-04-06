export type ProgressCandidateState =
  | "ACTIONABLE_TODAY"
  | "NEAR_ENTRY"
  | "QUALITY_WATCH"
  | "EXTENDED_LEADER"
  | "BLOCKED"
  | "AVOID";

export type ProgressCurrentRow = {
  symbol: string;
  universe_slug?: string | null;
  source_scan_date?: string | null;
  signal: "BUY" | "WATCH" | "AVOID";
  quality_score?: number | null;
  candidate_state?: string | null;
  candidate_state_label?: string | null;
  blockers?: string[] | null;
  dossier_summary?: string | null;
};

export type ProgressPriorRow = {
  symbol: string;
  universe_slug?: string | null;
  date?: string | null;
  signal: "BUY" | "WATCH" | "AVOID";
  quality_score?: number | null;
};

export type IdeaProgressChangeStatus = "NEW" | "UPGRADED" | "UNCHANGED" | "DOWNGRADED";

export type IdeaProgressChange = {
  status: IdeaProgressChangeStatus;
  label: string;
  prior_signal: "BUY" | "WATCH" | "AVOID" | null;
  prior_quality_score: number | null;
  prior_date: string | null;
  quality_delta: number | null;
};

function stateScore(state: string | null | undefined) {
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

function signalScore(signal: "BUY" | "WATCH" | "AVOID" | null | undefined) {
  switch (signal) {
    case "BUY":
      return 3;
    case "WATCH":
      return 2;
    default:
      return 1;
  }
}

function toNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function compareIdeaProgress(current: ProgressCurrentRow, prior: ProgressPriorRow | null): IdeaProgressChange {
  const currentQuality = toNumber(current.quality_score);
  if (!prior) {
    return {
      status: "NEW",
      label: "New today",
      prior_signal: null,
      prior_quality_score: null,
      prior_date: null,
      quality_delta: null,
    };
  }

  const priorQuality = toNumber(prior.quality_score);
  const qualityDelta =
    currentQuality != null && priorQuality != null ? Math.round((currentQuality - priorQuality) * 10) / 10 : null;

  const currentStateScore = stateScore(current.candidate_state);
  const priorSignalScore = signalScore(prior.signal);
  const currentSignalScore = signalScore(current.signal);

  let status: IdeaProgressChangeStatus = "UNCHANGED";
  if (currentStateScore > priorSignalScore || currentSignalScore > priorSignalScore) {
    status = "UPGRADED";
  } else if (currentStateScore < priorSignalScore || currentSignalScore < priorSignalScore) {
    status = "DOWNGRADED";
  } else if (qualityDelta != null && qualityDelta >= 7) {
    status = "UPGRADED";
  } else if (qualityDelta != null && qualityDelta <= -7) {
    status = "DOWNGRADED";
  }

  const deltaText =
    qualityDelta == null ? "" : qualityDelta > 0 ? `quality +${qualityDelta.toFixed(1)}` : qualityDelta < 0 ? `quality ${qualityDelta.toFixed(1)}` : "quality flat";

  const label =
    status === "UPGRADED"
      ? `Upgraded vs ${prior.date ?? "prior"}${deltaText ? ` • ${deltaText}` : ""}`
      : status === "DOWNGRADED"
        ? `Downgraded vs ${prior.date ?? "prior"}${deltaText ? ` • ${deltaText}` : ""}`
        : `Unchanged vs ${prior.date ?? "prior"}${deltaText ? ` • ${deltaText}` : ""}`;

  return {
    status,
    label,
    prior_signal: prior.signal,
    prior_quality_score: priorQuality,
    prior_date: prior.date ? String(prior.date) : null,
    quality_delta: qualityDelta,
  };
}

export function blockerCounts(rows: Array<Pick<ProgressCurrentRow, "blockers">>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const blockers = Array.isArray(row.blockers) ? row.blockers : [];
    for (const blocker of blockers) {
      counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function sortClosestToActionable<T extends ProgressCurrentRow>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const stateDelta = stateScore(b.candidate_state) - stateScore(a.candidate_state);
    if (stateDelta !== 0) return stateDelta;
    const blockersA = Array.isArray(a.blockers) ? a.blockers.length : 0;
    const blockersB = Array.isArray(b.blockers) ? b.blockers.length : 0;
    if (blockersA !== blockersB) return blockersA - blockersB;
    const qa = toNumber(a.quality_score) ?? 0;
    const qb = toNumber(b.quality_score) ?? 0;
    if (qb !== qa) return qb - qa;
    return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
  });
}
