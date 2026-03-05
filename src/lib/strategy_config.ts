export type StrategyStopConfig = {
  min_stop_pct: number;
  max_stop_pct: number;
};

const DEFAULT_CONFIG: StrategyStopConfig = {
  min_stop_pct: 0.02,
  max_stop_pct: 0.08,
};

export function getStrategyConfig(strategy_version: string): StrategyStopConfig {
  if (strategy_version === "v1_trend_hold") {
    return {
      min_stop_pct: 0.04,
      max_stop_pct: 0.12,
    };
  }
  if (strategy_version === "v2_core_momentum") {
    return {
      min_stop_pct: 0.02,
      max_stop_pct: 0.08,
    };
  }
  return DEFAULT_CONFIG;
}

