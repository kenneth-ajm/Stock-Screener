export function formatCurrency(value: number | null | undefined, isPrivateMode: boolean) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (isPrivateMode) return "••••••";
  return `$${value.toFixed(2)}`;
}

