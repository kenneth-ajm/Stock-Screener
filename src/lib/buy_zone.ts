export type StrategyVersion = "v2_core_momentum" | "v1_trend_hold";

export function getBuyZone({
  strategy_version,
  model_entry,
}: {
  strategy_version: string;
  model_entry: number;
}) {
  const entry = Number(model_entry);
  if (!Number.isFinite(entry) || entry <= 0) {
    return { zone_low: 0, zone_high: 0 };
  }

  if (strategy_version === "v1_trend_hold") {
    return {
      zone_low: entry * 0.985,
      zone_high: entry * 1.03,
    };
  }

  return {
    zone_low: entry * 0.99,
    zone_high: entry * 1.015,
  };
}

export function getEntryStatus({
  price,
  zone_low,
  zone_high,
}: {
  price: number | null | undefined;
  zone_low: number;
  zone_high: number;
}): "Below trigger" | "Within zone" | "Extended" | "Too extended" {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return "Below trigger";
  if (p < zone_low) return "Below trigger";
  if (p <= zone_high) return "Within zone";
  if (p <= zone_high * 1.02) return "Extended";
  return "Too extended";
}
