export type CockpitPlaybook = "FAST_MOMENTUM" | "QUALITY_PULLBACK";
export type CockpitCandidateState = "ACT_NOW" | "NEAR_TRIGGER";
export type CockpitExecutionState =
  | "ENTRY_ALIGNED"
  | "WAIT_FOR_TRIGGER"
  | "AT_TRIGGER_WAIT_CONFIRMATION"
  | "DO_NOT_CHASE"
  | "CACHED_CLOSE_ONLY";

export type CockpitCandidate = {
  symbol: string;
  name: string;
  playbook: CockpitPlaybook;
  playbook_label: string;
  strategy_version: string;
  universe_slug: string;
  state: CockpitCandidateState;
  state_label: string;
  setup_label: string;
  score: number | null;
  reference_price: number | null;
  quote_price: number | null;
  quote_as_of: string | null;
  quote_source: "provider_snapshot" | "cached_daily_close";
  entry_price: number | null;
  stop_price: number | null;
  tp1_price: number | null;
  tp2_price: number | null;
  target_model: string | null;
  tp1_reason: string | null;
  tp2_reason: string | null;
  expected_hold: string;
  source_date: string | null;
  reason_summary: string;
  next_trigger: string;
  execution_state: CockpitExecutionState;
  execution_label: string;
  ticket_href: string;
  details: Array<{ label: string; value: string }>;
};

export type CockpitPosition = {
  symbol: string;
  strategy_version: string | null;
  strategy_label: string;
  lots: number;
  quantity: number;
  average_entry: number | null;
  current_price: number | null;
  quote_as_of: string | null;
  stop_price: number | null;
  tp1_price: number | null;
  tp2_price: number | null;
  unrealized_pct: number | null;
  management_state: "STOP_BREACHED" | "TP2_REACHED" | "TP1_REACHED" | "TIME_REVIEW" | "HOLD";
  management_label: string;
  management_summary: string;
  held_days: number | null;
  max_hold_days: number | null;
};

export type DailyCockpitPayload = {
  ok: boolean;
  generated_at: string;
  market: {
    provider_id: string;
    provider_label: string;
    provider_configured: boolean;
    quote_mode: "provider_snapshot_with_cached_fallback" | "cached_daily_close_only";
    expected_completed_session: string;
    source_date: string | null;
    sessions_behind: number | null;
    freshness_state: "current" | "stale" | "unavailable";
    spy_healthy: boolean | null;
    regime_label: string;
  };
  summary: {
    act_now: number;
    near_trigger: number;
    positions_to_manage: number;
    open_positions: number;
  };
  act_now: CockpitCandidate[];
  near_trigger: CockpitCandidate[];
  positions: CockpitPosition[];
  portfolio: {
    cash_available: number | null;
    account_size: number | null;
    open_symbols: number;
  };
  sources: {
    tactical: { ok: boolean; rows: number; scanned_symbols: number; source_date: string | null; error: string | null };
    quality: { ok: boolean; rows: number; watchlist_size: number; source_date: string | null; error: string | null };
  };
  warnings: string[];
};

export function money(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

export function percent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}
