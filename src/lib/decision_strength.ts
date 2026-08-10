export type DecisionSignal = "BUY" | "WATCH" | "AVOID";

type DecisionStrengthInput = {
  signal: DecisionSignal;
  technical_score?: number | null;
  quality_score?: number | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Converts setup quality into a signal-aligned strength indicator.
 * This is a prioritization score, not a probability or expected return.
 */
export function computeDecisionStrength(input: DecisionStrengthInput) {
  const quality = finiteOrNull(input.quality_score);
  const technical = finiteOrNull(input.technical_score);
  const basis = clamp(quality ?? technical ?? 50, 0, 100);

  if (input.signal === "BUY") return Math.round(clamp(basis, 70, 99));
  if (input.signal === "WATCH") return Math.round(clamp(basis, 40, 79));
  return Math.round(clamp(basis, 0, 49));
}
