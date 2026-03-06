export type ExecutionAction = "BUY NOW" | "WAIT" | "SKIP";

export type ExecutionState = {
  action: ExecutionAction;
  reasonLabel: string;
};

export function mapExecutionState(reasonInput: string | null | undefined): ExecutionState {
  const reasonLabel = String(reasonInput ?? "").trim() || "No live price";
  const reason = reasonLabel.toLowerCase();

  if (reason.includes("within zone") || reason.includes("actionable")) {
    return { action: "BUY NOW", reasonLabel };
  }

  if (reason.includes("below trigger") || reason.includes("not triggered") || reason.includes("no live")) {
    return { action: "WAIT", reasonLabel };
  }

  if (
    reason.includes("mismatch") ||
    reason.includes("too extended") ||
    reason.includes("extended") ||
    reason.includes("stop too wide") ||
    reason.includes("insufficient cash") ||
    reason.includes("invalid stop")
  ) {
    return { action: "SKIP", reasonLabel };
  }

  return { action: "WAIT", reasonLabel };
}
