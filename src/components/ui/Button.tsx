import { cx } from "@/lib/ui";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  children,
  className,
  variant = "secondary",
  type,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: Variant;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const styles =
    variant === "primary"
      ? "bg-slate-900 text-white hover:bg-slate-800"
      : variant === "ghost"
      ? "bg-transparent hover:bg-slate-100"
      : "bg-white hover:bg-slate-50 border border-slate-200";

  return (
    <button
      type={type ?? "button"}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium",
        "shadow-sm ring-1 ring-black/5",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        styles,
        className
      )}
    >
      {children}
    </button>
  );
}
