export const MOMENTUM_BASELINE_ID = "momentum_baseline_2026_08_11";

export const MOMENTUM_BASELINE_PARAMETERS = {
  minimum_history_bars: 220,
  buy_rsi_min: 50,
  buy_rsi_max: 65,
  watch_rsi_min: 45,
  watch_rsi_max: 70,
  buy_relative_volume_min: 1.2,
  watch_relative_volume_min: 1.1,
  buy_max_extension_atr: 1.5,
  watch_max_extension_atr: 2,
  minimum_average_dollar_volume: 50_000_000,
  minimum_market_cap: 2_000_000_000,
  maximum_holding_days: 7,
} as const;

export const MOMENTUM_PARAMETER_PROVENANCE = {
  baseline_id: MOMENTUM_BASELINE_ID,
  status: "engineering_baseline_not_calibrated",
  production_behavior_changed: false,
  broad_evidence: {
    trend_alignment: "Momentum and trend persistence are supported by published empirical research.",
    relative_volume: "Volume can contain information about momentum persistence, but no source proves 1.2x is universally optimal.",
    rsi: "RSI bands are conventional technical-analysis heuristics and should be treated as adjustable ranges.",
    atr_extension: "ATR normalization is a risk-control convention; the exact multiple requires empirical validation.",
    holding_period: "The seven-session time stop is a product design choice for short swing trades, not a research optimum.",
  },
  limitations: [
    "No completed walk-forward calibration exists for these exact values.",
    "Current historical scans use present-day universe membership and therefore contain survivorship bias.",
    "Thresholds must not be promoted as optimized until point-in-time data and out-of-sample evaluation are available.",
  ],
} as const;

export const MOMENTUM_CALIBRATION_CANDIDATES = {
  buy_rsi_min: [48, 50, 52],
  buy_rsi_max: [62, 65, 68],
  buy_relative_volume_min: [1, 1.1, 1.2, 1.35],
  buy_max_extension_atr: [1.25, 1.5, 1.75, 2],
  maximum_holding_days: [5, 7, 10, 15],
} as const;

export function momentumBaselineManifest() {
  return {
    ...MOMENTUM_PARAMETER_PROVENANCE,
    parameters: MOMENTUM_BASELINE_PARAMETERS,
    candidate_ranges: MOMENTUM_CALIBRATION_CANDIDATES,
  };
}
