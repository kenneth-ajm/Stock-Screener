export type ExecutionSignal = "BUY" | "WATCH" | "AVOID";
export type ExecutionAction = "BUY_NOW" | "WAIT" | "SKIP";

export type ExecutionInput = {
  signal: ExecutionSignal;
  idealEntry: number;
  stop: number;
  live?: number | null;
  atr?: number | null;
  confidence?: number | null;
  strategyVersion?: string;
};

export type ExecutionOutput = {
  action: ExecutionAction;
  reasons: string[];
  entryUsed: number;
  riskPerShare: number;
  rrToTP2: number;
  tp1: number;
  tp2: number;
  flags: { late: boolean; priceMismatch: boolean; stopTooWide: boolean; stopVeryWide: boolean };
  extensionPct: number;
  extensionAtr: number | null;
  stopDistancePct: number;
};

export const EXECUTION_LIMITS = {
  PRICE_MISMATCH_PCT: 0.2,
  BUY_EXT_PCT_MAX: 0.05,
  WAIT_EXT_PCT_NO_ATR: 0.08,
  SKIP_EXT_PCT: 0.1,
  WAIT_EXT_ATR: 1.5,
  SKIP_EXT_ATR: 2.0,
  MAX_STOP_DISTANCE_PCT: 0.1,
  TREND_MAX_STOP_DISTANCE_PCT: 0.18,
  TREND_WARN_STOP_DISTANCE_PCT: 0.14,
} as const;

function safeNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function computeExecutionGuidance(input: ExecutionInput): ExecutionOutput {
  const idealEntry = safeNumber(input.idealEntry) ?? 0;
  const live = safeNumber(input.live);
  const atr = safeNumber(input.atr);
  const entryUsed = live !== null && live > 0 ? live : idealEntry;
  const stop = safeNumber(input.stop) ?? NaN;

  const extensionPct = idealEntry > 0 ? Math.max(0, (entryUsed - idealEntry) / idealEntry) : 0;
  const extensionAtr = atr !== null && atr > 0 ? Math.max(0, entryUsed - idealEntry) / atr : null;
  const late = entryUsed > idealEntry;
  const priceMismatch =
    idealEntry > 0 && Math.abs(entryUsed - idealEntry) / idealEntry > EXECUTION_LIMITS.PRICE_MISMATCH_PCT;

  if (!Number.isFinite(entryUsed) || entryUsed <= 0 || !Number.isFinite(stop) || stop <= 0 || stop >= entryUsed) {
    return {
      action: "SKIP",
      reasons: ["Invalid stop"],
      entryUsed: Number.isFinite(entryUsed) ? entryUsed : idealEntry,
      riskPerShare: NaN,
      rrToTP2: 0,
      tp1: NaN,
      tp2: NaN,
      flags: { late, priceMismatch, stopTooWide: false, stopVeryWide: false },
      extensionPct,
      extensionAtr,
      stopDistancePct: NaN,
    };
  }

  const riskPerShare = entryUsed - stop;
  const tp1 = entryUsed * 1.05;
  const tp2 = entryUsed * 1.1;
  const stopDistancePct = riskPerShare / entryUsed;
  const reasons: string[] = [];
  const strategyVersion = String(input.strategyVersion ?? "v2_core_momentum");
  const isTrend = strategyVersion === "v1_trend_hold";
  const tp1Used = isTrend ? entryUsed * 1.1 : tp1;
  const tp2Used = isTrend ? entryUsed * 1.2 : tp2;
  const stopTooWide = isTrend
    ? stopDistancePct > EXECUTION_LIMITS.TREND_MAX_STOP_DISTANCE_PCT
    : stopDistancePct > EXECUTION_LIMITS.MAX_STOP_DISTANCE_PCT;
  const stopVeryWide = isTrend
    ? stopDistancePct > EXECUTION_LIMITS.TREND_WARN_STOP_DISTANCE_PCT
    : stopTooWide;

  if (input.signal === "AVOID") reasons.push("Signal is AVOID");
  if (priceMismatch) reasons.push("Price mismatch >20%");
  if (live === null) reasons.push("No live price; use entry zone");
  if (stopTooWide) {
    reasons.push(
      isTrend
        ? "Stop too wide (>18%) for trend-hold system"
        : "Stop too wide (>10%) for short-term system"
    );
  } else if (stopVeryWide && isTrend) {
    reasons.push("Stop is very wide for trend-hold");
  }
  if (extensionAtr !== null && extensionAtr > EXECUTION_LIMITS.WAIT_EXT_ATR) reasons.push("Extended");
  if (atr === null && extensionPct >= EXECUTION_LIMITS.WAIT_EXT_PCT_NO_ATR) reasons.push("Late by >8% without ATR");

  let action: ExecutionAction = "WAIT";

  const extremeExtension =
    (extensionAtr !== null && extensionAtr > EXECUTION_LIMITS.SKIP_EXT_ATR) ||
    extensionPct > EXECUTION_LIMITS.SKIP_EXT_PCT;

  if (input.signal === "AVOID") action = "SKIP";
  else if (priceMismatch) action = input.signal === "BUY" ? "SKIP" : "WAIT";
  else if (stopTooWide) action = "SKIP";
  else if (extremeExtension) action = "SKIP";
  else if (live === null) action = "WAIT";
  else if (extensionAtr !== null && extensionAtr > EXECUTION_LIMITS.WAIT_EXT_ATR) action = "WAIT";
  else if (atr === null && extensionPct >= EXECUTION_LIMITS.WAIT_EXT_PCT_NO_ATR) action = "WAIT";
  else {
    const notExtended = extensionAtr !== null ? extensionAtr <= EXECUTION_LIMITS.WAIT_EXT_ATR : extensionPct < EXECUTION_LIMITS.BUY_EXT_PCT_MAX;
    if (input.signal === "BUY" && notExtended) action = "BUY_NOW";
    else action = "WAIT";
  }

  return {
    action,
    reasons: reasons.length > 0 ? reasons : ["Entry and stop are actionable"],
    entryUsed,
    riskPerShare,
    rrToTP2: riskPerShare > 0 ? (tp2Used - entryUsed) / riskPerShare : 0,
    tp1: tp1Used,
    tp2: tp2Used,
    flags: { late, priceMismatch, stopTooWide, stopVeryWide },
    extensionPct,
    extensionAtr,
    stopDistancePct,
  };
}
