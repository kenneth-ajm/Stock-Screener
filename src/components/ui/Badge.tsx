import { cx } from "@/lib/ui";

type Variant = "buy" | "watch" | "avoid" | "neutral";

export function Badge({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: Variant;
}) {
  const styles =
    variant === "buy"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
      : variant === "watch"
      ? "bg-amber-50 text-amber-900 ring-amber-100"
      : variant === "avoid"
      ? "bg-red-50 text-red-800 ring-red-100"
      : "bg-slate-100 text-slate-700 ring-slate-200";

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        "ring-1",
        styles
      )}
    >
      {children}
    </span>
  );
}
