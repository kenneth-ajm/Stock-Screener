export type ExecutionSignal = "BUY" | "WATCH" | "AVOID";
export type ExecutionAction = "BUY_NOW" | "WAIT" | "SKIP";

export type ExecutionInput = {
  signal: ExecutionSignal;
  idealEntry: number;
  stop: number;
  live?: number | null;
  atr?: number | null;
  confidence?: number | null;
};

export type ExecutionOutput = {
  action: ExecutionAction;
  reasons: string[];
  entryUsed: number;
  riskPerShare: number;
  rrToTP2: number;
  tp1: number;
  tp2: number;
  flags: { late: boolean; priceMismatch: boolean };
  extensionPct: number;
  extensionAtr: number | null;
  riskPct: number;
};

export const EXECUTION_LIMITS = {
  PRICE_MISMATCH_PCT: 0.2,
  BUY_EXT_PCT_MAX: 0.05,
  WAIT_EXT_PCT_NO_ATR: 0.08,
  SKIP_EXT_PCT: 0.1,
  WAIT_EXT_ATR: 1.5,
  SKIP_EXT_ATR: 2.0,
  MAX_RISK_PCT: 0.12,
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
      flags: { late, priceMismatch },
      extensionPct,
      extensionAtr,
      riskPct: NaN,
    };
  }

  const riskPerShare = entryUsed - stop;
  const tp1 = entryUsed + riskPerShare;
  const tp2 = entryUsed + 2 * riskPerShare;
  const riskPct = riskPerShare / entryUsed;
  const reasons: string[] = [];

  if (input.signal === "AVOID") reasons.push("Signal is AVOID");
  if (live === null) reasons.push("No live price; use entry zone");
  if (riskPct > EXECUTION_LIMITS.MAX_RISK_PCT) reasons.push("Risk wide");
  if (extensionAtr !== null && extensionAtr > EXECUTION_LIMITS.WAIT_EXT_ATR) reasons.push("Extended");
  if (atr === null && extensionPct >= EXECUTION_LIMITS.WAIT_EXT_PCT_NO_ATR) reasons.push("Late by >8% without ATR");

  let action: ExecutionAction = "WAIT";

  const extremeExtension =
    (extensionAtr !== null && extensionAtr > EXECUTION_LIMITS.SKIP_EXT_ATR) ||
    extensionPct > EXECUTION_LIMITS.SKIP_EXT_PCT;

  if (input.signal === "AVOID") action = "SKIP";
  else if (extremeExtension) action = "SKIP";
  else if (live === null) action = "WAIT";
  else if (riskPct > EXECUTION_LIMITS.MAX_RISK_PCT) action = "WAIT";
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
    rrToTP2: 2,
    tp1,
    tp2,
    flags: { late, priceMismatch },
    extensionPct,
    extensionAtr,
    riskPct,
  };
}

