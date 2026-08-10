import { getBuyZone, getEntryStatus } from "@/lib/buy_zone";
import { applyEarningsRiskToAction, type EarningsRisk } from "@/lib/earnings_risk";
import { mapExecutionState, type ExecutionAction } from "@/lib/execution_state";
import { applyBreadthToAction, type MarketBreadth } from "@/lib/market_breadth";

export type StoredExecutionAction = "BUY_NOW" | "WAIT" | "SKIP";
export type RuntimePriceSource = "LIVE_QUOTE" | "LATEST_DAILY_CLOSE" | "SCAN_CLOSE" | "UNAVAILABLE";

export type RuntimeQuote = {
  price: number;
  asOf?: string | null;
  source: "snapshot" | "eod_close";
} | null;

export type RuntimeIdeaExecution = {
  action: StoredExecutionAction;
  displayAction: ExecutionAction;
  reasonLabel: string;
  breadthLabel: string | null;
  referencePrice: number | null;
  referenceAsOf: string | null;
  priceSource: RuntimePriceSource;
  priceSourceLabel: string;
  deltaPct: number | null;
  entryStatus: ReturnType<typeof getEntryStatus> | null;
  mismatch: boolean;
};

type RuntimeIdeaExecutionInput = {
  strategyVersion: string;
  entry: number;
  scanClose?: number | null;
  quote?: RuntimeQuote;
  fallbackAction?: StoredExecutionAction | null;
  earnings?: EarningsRisk | null;
  breadth?: Pick<MarketBreadth, "breadthState" | "breadthLabel"> | null;
  priceMismatchThreshold?: number;
};

function toPositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function toStoredAction(action: ExecutionAction): StoredExecutionAction {
  if (action === "BUY NOW") return "BUY_NOW";
  return action;
}

function fallbackExecution(action: StoredExecutionAction | null | undefined) {
  if (action === "SKIP") return { action: "SKIP" as ExecutionAction, reasonLabel: "Cached scan says skip" };
  return {
    action: "WAIT" as ExecutionAction,
    reasonLabel: action === "BUY_NOW" ? "Current price unavailable; recheck entry" : "Current price unavailable",
  };
}

/**
 * Produces one execution decision for the summary, filters, table, and ticket.
 * Daily-close data is a valid source for this daily-timeframe product; a live
 * quote enhances timing but is not required to render a cached scan coherently.
 */
export function evaluateIdeaRuntimeExecution(input: RuntimeIdeaExecutionInput): RuntimeIdeaExecution {
  const entry = toPositiveNumber(input.entry) ?? 0;
  const quotePrice = toPositiveNumber(input.quote?.price);
  const scanClose = toPositiveNumber(input.scanClose);
  const mismatchThreshold = Number.isFinite(Number(input.priceMismatchThreshold))
    ? Math.max(0, Number(input.priceMismatchThreshold))
    : 0.6;
  const mismatch = Boolean(
    quotePrice !== null && entry > 0 && Math.abs((quotePrice - entry) / entry) > mismatchThreshold
  );

  let referencePrice: number | null = null;
  let referenceAsOf: string | null = null;
  let priceSource: RuntimePriceSource = "UNAVAILABLE";
  let priceSourceLabel = "Price unavailable";

  if (quotePrice !== null) {
    referencePrice = quotePrice;
    referenceAsOf = String(input.quote?.asOf ?? "").trim() || null;
    priceSource = input.quote?.source === "snapshot" ? "LIVE_QUOTE" : "LATEST_DAILY_CLOSE";
    priceSourceLabel = input.quote?.source === "snapshot" ? "Latest quote" : "Latest daily close";
  } else if (scanClose !== null) {
    referencePrice = scanClose;
    priceSource = "SCAN_CLOSE";
    priceSourceLabel = "Scan-date close";
  }

  const buyZone = entry > 0 ? getBuyZone({ strategy_version: input.strategyVersion, model_entry: entry }) : null;
  const entryStatus =
    !mismatch && referencePrice !== null && buyZone
      ? getEntryStatus({ price: referencePrice, zone_low: buyZone.zone_low, zone_high: buyZone.zone_high })
      : null;

  const base = mismatch
    ? { action: "SKIP" as ExecutionAction, reasonLabel: "Price mismatch" }
    : entryStatus
      ? mapExecutionState(entryStatus)
      : fallbackExecution(input.fallbackAction);
  const execution = applyBreadthToAction(applyEarningsRiskToAction(base, input.earnings), input.breadth);
  const deltaPct = referencePrice !== null && entry > 0 ? ((referencePrice - entry) / entry) * 100 : null;

  return {
    action: toStoredAction(execution.action),
    displayAction: execution.action,
    reasonLabel: execution.reasonLabel,
    breadthLabel: execution.breadthLabel ?? null,
    referencePrice,
    referenceAsOf,
    priceSource,
    priceSourceLabel,
    deltaPct,
    entryStatus,
    mismatch,
  };
}
