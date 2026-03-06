import type { ExecutionAction } from "@/lib/execution_state";

export type EarningsRiskState = "block" | "warn" | "none";

export type EarningsRisk = {
  daysToEarnings: number | null;
  earningsLabel: "Earnings soon" | "Earnings upcoming" | null;
  earningsRiskState: EarningsRiskState;
  earningsDate: string | null;
};

type NextTickerRef = {
  results?: {
    next_earnings_date?: string | null;
    earnings_release_date?: string | null;
  } | null;
};

const BLOCK_DAYS = 5;
const WARN_DAYS = 10;

function toUtcDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDateOnly(input: string | null | undefined) {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function daysDiffFromToday(targetDate: Date, now = new Date()) {
  const t = toUtcDateOnly(targetDate).getTime();
  const n = toUtcDateOnly(now).getTime();
  return Math.round((t - n) / (24 * 60 * 60 * 1000));
}

export function classifyEarningsRisk(nextEarningsDate: string | null | undefined, now = new Date()): EarningsRisk {
  const dt = parseDateOnly(nextEarningsDate);
  if (!dt) {
    return {
      daysToEarnings: null,
      earningsLabel: null,
      earningsRiskState: "none",
      earningsDate: null,
    };
  }
  const days = daysDiffFromToday(dt, now);
  if (days >= 0 && days <= BLOCK_DAYS) {
    return {
      daysToEarnings: days,
      earningsLabel: "Earnings soon",
      earningsRiskState: "block",
      earningsDate: nextEarningsDate ?? null,
    };
  }
  if (days >= BLOCK_DAYS + 1 && days <= WARN_DAYS) {
    return {
      daysToEarnings: days,
      earningsLabel: "Earnings upcoming",
      earningsRiskState: "warn",
      earningsDate: nextEarningsDate ?? null,
    };
  }
  return {
    daysToEarnings: days,
    earningsLabel: null,
    earningsRiskState: "none",
    earningsDate: nextEarningsDate ?? null,
  };
}

export async function fetchNextEarningsDatePolygon(symbol: string, apiKey: string) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym || !apiKey) return null;
  const url = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(sym)}?apiKey=${apiKey}`;
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), 8_000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as NextTickerRef | null;
    const d1 = json?.results?.next_earnings_date;
    const d2 = json?.results?.earnings_release_date;
    return (d1 && String(d1)) || (d2 && String(d2)) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

export async function lookupEarningsRiskForSymbols(symbols: string[]) {
  const apiKey = process.env.POLYGON_API_KEY ?? "";
  const uniq = Array.from(new Set((symbols ?? []).map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean)));
  const out: Record<string, EarningsRisk> = {};
  if (!apiKey || uniq.length === 0) return out;
  const results = await Promise.all(
    uniq.map(async (symbol) => {
      const date = await fetchNextEarningsDatePolygon(symbol, apiKey);
      return [symbol, classifyEarningsRisk(date)] as const;
    })
  );
  for (const [symbol, risk] of results) out[symbol] = risk;
  return out;
}

export function applyEarningsRiskToAction(
  base: { action: ExecutionAction; reasonLabel: string },
  earnings: EarningsRisk | null | undefined
) {
  if (!earnings || earnings.earningsRiskState === "none") return base;
  if (earnings.earningsRiskState === "block") {
    return { action: "SKIP" as ExecutionAction, reasonLabel: "Earnings soon" };
  }
  return {
    action: base.action,
    reasonLabel: "Earnings upcoming",
  };
}

