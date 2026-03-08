import { CORE_MOMENTUM_DEFAULT_VERSION } from "@/lib/strategy/coreMomentumSwing";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";
import { SECTOR_MOMENTUM_STRATEGY_VERSION } from "@/lib/sector_momentum";

export const CORE_UNIVERSE_SLUG = "core_800";
export const MIDCAP_UNIVERSE_SLUG = "midcap_1000";
export const GROWTH_UNIVERSE_SLUG = "growth_1500";
export const LEGACY_MOMENTUM_UNIVERSE_SLUG = "liquid_2000";

export function defaultUniverseForStrategy(strategyVersion: string) {
  const strategy = String(strategyVersion ?? "").trim();
  if (strategy === "v1") return LEGACY_MOMENTUM_UNIVERSE_SLUG;
  if (strategy === SECTOR_MOMENTUM_STRATEGY_VERSION) return GROWTH_UNIVERSE_SLUG;
  if (strategy === TREND_HOLD_DEFAULT_VERSION) return CORE_UNIVERSE_SLUG;
  if (strategy === CORE_MOMENTUM_DEFAULT_VERSION) return CORE_UNIVERSE_SLUG;
  return CORE_UNIVERSE_SLUG;
}

export function allowedUniversesForStrategy(strategyVersion: string) {
  const strategy = String(strategyVersion ?? "").trim();
  if (strategy === "v1") return [LEGACY_MOMENTUM_UNIVERSE_SLUG, MIDCAP_UNIVERSE_SLUG];
  if (strategy === TREND_HOLD_DEFAULT_VERSION) return [CORE_UNIVERSE_SLUG, LEGACY_MOMENTUM_UNIVERSE_SLUG];
  if (strategy === SECTOR_MOMENTUM_STRATEGY_VERSION) return [GROWTH_UNIVERSE_SLUG, MIDCAP_UNIVERSE_SLUG];
  return [defaultUniverseForStrategy(strategy)];
}
