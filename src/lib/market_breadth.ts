import type { ExecutionAction } from "@/lib/execution_state";

export type BreadthState = "STRONG" | "MIXED" | "WEAK";

export type MarketBreadth = {
  pctAboveSma50: number;
  pctAboveSma200: number;
  breadthState: BreadthState;
  breadthLabel: string;
  sampleSize: number;
};

function toNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

function getCheckPass(check: any): boolean | null {
  if (!check || typeof check !== "object") return null;
  const keys = ["pass", "passed", "ok", "value"];
  for (const k of keys) {
    const b = toBool(check?.[k]);
    if (b !== null) return b;
  }
  return null;
}

function hasName(check: any, needle: string) {
  const text = String(
    check?.id ?? check?.key ?? check?.name ?? check?.check ?? check?.label ?? check?.field ?? ""
  ).toLowerCase();
  return text.includes(needle);
}

function extractAboveSma(reasonJson: any, smaTag: "sma50" | "sma200"): boolean | null {
  const checks = Array.isArray(reasonJson?.checks) ? reasonJson.checks : [];
  for (const c of checks) {
    if (!hasName(c, smaTag)) continue;
    if (!hasName(c, "above") && !hasName(c, "close")) continue;
    const b = getCheckPass(c);
    if (b !== null) return b;
  }
  const metrics = reasonJson?.metrics ?? {};
  const distKeys =
    smaTag === "sma50"
      ? ["distToSMA50", "dist_to_sma50", "distance_to_sma50"]
      : ["distToSMA200", "dist_to_sma200", "distance_to_sma200"];
  for (const k of distKeys) {
    const n = toNumber(metrics?.[k]);
    if (n === null) continue;
    return n >= 0;
  }
  return null;
}

function classifyBreadth({
  regimeState,
  pctAboveSma50,
  pctAboveSma200,
}: {
  regimeState: string | null | undefined;
  pctAboveSma50: number;
  pctAboveSma200: number;
}): { state: BreadthState; label: string } {
  const favorable = String(regimeState ?? "").toUpperCase() === "FAVORABLE";
  if (favorable && pctAboveSma50 >= 60 && pctAboveSma200 >= 50) {
    return { state: "STRONG", label: "Breadth strong" };
  }
  if (!favorable || pctAboveSma50 < 40 || pctAboveSma200 < 35) {
    return { state: "WEAK", label: "Breadth weak" };
  }
  return { state: "MIXED", label: "Breadth mixed" };
}

export async function computeMarketBreadth(opts: {
  supabase: any;
  date: string | null;
  universe_slug: string;
  strategy_version: string;
  regime_state: string | null;
}): Promise<MarketBreadth> {
  if (!opts.date) {
    return {
      pctAboveSma50: 0,
      pctAboveSma200: 0,
      breadthState: "WEAK",
      breadthLabel: "Breadth weak",
      sampleSize: 0,
    };
  }
  const supa = opts.supabase as any;
  const { data } = await supa
    .from("daily_scans")
    .select("symbol,reason_json")
    .eq("date", opts.date)
    .eq("universe_slug", opts.universe_slug)
    .eq("strategy_version", opts.strategy_version)
    .limit(2000);
  const rows = Array.isArray(data) ? data : [];
  const total = rows.length;
  if (total === 0) {
    const out = classifyBreadth({
      regimeState: opts.regime_state,
      pctAboveSma50: 0,
      pctAboveSma200: 0,
    });
    return {
      pctAboveSma50: 0,
      pctAboveSma200: 0,
      breadthState: out.state,
      breadthLabel: out.label,
      sampleSize: 0,
    };
  }

  let above50 = 0;
  let above200 = 0;
  for (const row of rows) {
    const reason = row?.reason_json ?? null;
    const a50 = extractAboveSma(reason, "sma50");
    const a200 = extractAboveSma(reason, "sma200");
    if (a50 === true) above50 += 1;
    if (a200 === true) above200 += 1;
  }
  const pct50 = (above50 / total) * 100;
  const pct200 = (above200 / total) * 100;
  const out = classifyBreadth({
    regimeState: opts.regime_state,
    pctAboveSma50: pct50,
    pctAboveSma200: pct200,
  });
  return {
    pctAboveSma50: pct50,
    pctAboveSma200: pct200,
    breadthState: out.state,
    breadthLabel: out.label,
    sampleSize: total,
  };
}

export function applyBreadthToAction(
  base: { action: ExecutionAction; reasonLabel: string },
  breadth: Pick<MarketBreadth, "breadthState" | "breadthLabel"> | null | undefined
) {
  if (!breadth || breadth.breadthState === "STRONG") {
    return { ...base, breadthLabel: null as string | null };
  }
  if (breadth.breadthState === "MIXED") {
    return { ...base, breadthLabel: "Breadth mixed" as string | null };
  }
  if (base.action === "BUY NOW") {
    return { action: "WAIT" as ExecutionAction, reasonLabel: "Weak breadth", breadthLabel: "Breadth weak" };
  }
  if (base.action === "WAIT") {
    return { action: "SKIP" as ExecutionAction, reasonLabel: "Weak breadth", breadthLabel: "Breadth weak" };
  }
  return { ...base, breadthLabel: "Breadth weak" as string | null };
}

