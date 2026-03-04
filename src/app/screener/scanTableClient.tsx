"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { computeExecutionGuidance, type ExecutionAction } from "@/lib/execution";
import { fmt2, fmtCompact, fmtDate, fmtInt, fmtMoney } from "@/lib/format";

type Row = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  entry: number;
  stop: number;
  reason_json?: any;
};

type QuoteValue = {
  price: number;
  asOf: string;
  source: "snapshot" | "eod_close";
} | null;

type DisplayRow = Row & {
  effectiveSignal: "BUY" | "WATCH" | "AVOID";
  livePrice: number | null;
  liveSource: string | null;
  divergencePct: number | null;
  priceMismatch: boolean;
  atr14: number | null;
  execution: ReturnType<typeof computeExecutionGuidance>;
  staleScan: boolean;
  eventRisk: boolean;
  newsRisk: boolean;
};

function chipClass(active: boolean) {
  return [
    "rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide",
    active
      ? "border-slate-300 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
  ].join(" ");
}

function signalPill(signal: Row["signal"]) {
  if (signal === "BUY") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (signal === "WATCH") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function actionPill(action: ExecutionAction) {
  if (action === "BUY_NOW") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (action === "WAIT") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-300";
}

function actionLabel(action: ExecutionAction) {
  if (action === "BUY_NOW") return "BUY NOW";
  if (action === "WAIT") return "WAIT";
  return "SKIP";
}

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeDivergencePct(entry: number | null, live: number | null) {
  if (entry === null || live === null || !Number.isFinite(entry) || !Number.isFinite(live) || entry <= 0) {
    return null;
  }
  return Math.abs(live - entry) / entry;
}

function extractAtr14FromReasonJson(row: Row) {
  const n = asNumber(
    row?.reason_json?.indicators?.atr14 ??
      row?.reason_json?.metrics?.atr14 ??
      row?.reason_json?.atr14
  );
  return n !== null && n > 0 ? n : null;
}

function extractCalcMetrics(payload: any, fallback?: { entry?: number; stop?: number }) {
  const entry = asNumber(payload?.entry ?? payload?.entry_price ?? fallback?.entry);
  const stop = asNumber(payload?.stop ?? payload?.stop_price ?? fallback?.stop);
  const shares = asNumber(
    payload?.shares ?? payload?.qty ?? payload?.quantity ?? payload?.size ?? payload?.position_size
  );
  const accountSize = asNumber(payload?.account_size ?? payload?.portfolio_value ?? payload?.accountValue);
  const cashAvailable = asNumber(payload?.cash_available ?? payload?.cashAvailable);
  const investedValue = asNumber(payload?.invested_value ?? payload?.investedValue);
  const equity = asNumber(payload?.equity ?? payload?.portfolio_equity);
  const defaultFeePerOrder = asNumber(payload?.default_fee_per_order ?? payload?.defaultFeePerOrder);
  const riskPerTrade = asNumber(
    payload?.risk_per_trade ??
      payload?.risk_per_trade_pct ??
      payload?.riskPct ??
      payload?.risk_percent
  );

  const riskPerShare = entry !== null && stop !== null ? entry - stop : null;
  const riskPct =
    riskPerTrade === null ? null : riskPerTrade <= 1 ? riskPerTrade * 100 : riskPerTrade;
  const maxRiskUsd =
    asNumber(payload?.risk_usd ?? payload?.riskUsd ?? payload?.risk_amount ?? payload?.max_loss) ??
    (accountSize !== null && riskPct !== null ? accountSize * (riskPct / 100) : null);
  const positionCost =
    asNumber(payload?.position_cost ?? payload?.position_value ?? payload?.positionValue) ??
    (shares !== null && entry !== null ? shares * entry : null);
  const sharesByRisk = asNumber(payload?.shares_by_risk ?? payload?.sharesByRisk);
  const sharesByCash = asNumber(payload?.shares_by_cash ?? payload?.sharesByCash);

  return {
    entry,
    stop,
    shares,
    sharesByRisk,
    sharesByCash,
    accountSize,
    cashAvailable,
    investedValue,
    equity,
    defaultFeePerOrder,
    riskPct,
    riskPerShare,
    maxRiskUsd,
    positionCost,
  };
}

type CheckCategory =
  | "trend"
  | "leadership"
  | "rs"
  | "momentum"
  | "volatility"
  | "pullback"
  | "liquidity"
  | "flags"
  | "volume"
  | "risk"
  | "regime"
  | "execution";

const CHECK_CATEGORY_ORDER: CheckCategory[] = [
  "trend",
  "leadership",
  "rs",
  "momentum",
  "volatility",
  "pullback",
  "liquidity",
  "flags",
  "volume",
  "risk",
  "regime",
  "execution",
];

function categoryForCheck(c: any): CheckCategory {
  const explicit = String(c?.category ?? "").toLowerCase();
  if (CHECK_CATEGORY_ORDER.includes(explicit as CheckCategory)) return explicit as CheckCategory;
  const key = String(c?.key ?? "").toLowerCase();
  const label = String(c?.label ?? "").toLowerCase();
  const text = `${key} ${label}`;
  if (text.includes("regime")) return "regime";
  if (text.includes("leader") || text.includes("52w") || text.includes("high") || text.includes("low"))
    return "leadership";
  if (text.includes("rs ") || text.includes("relative strength") || text.includes("spy")) return "rs";
  if (text.includes("volatility")) return "volatility";
  if (text.includes("pullback")) return "pullback";
  if (text.includes("liquidity")) return "liquidity";
  if (text.includes("flag") || text.includes("event")) return "flags";
  if (text.includes("volume")) return "volume";
  if (text.includes("rsi") || text.includes("momentum")) return "momentum";
  if (text.includes("stop") || text.includes("risk") || text.includes("extend") || text.includes("atr"))
    return "risk";
  if (text.includes("execution")) return "execution";
  return "trend";
}

function categoryLabel(c: CheckCategory) {
  if (c === "trend") return "Trend";
  if (c === "leadership") return "Leadership";
  if (c === "rs") return "RS";
  if (c === "momentum") return "Momentum";
  if (c === "volatility") return "Volatility";
  if (c === "pullback") return "Pullback";
  if (c === "liquidity") return "Liquidity";
  if (c === "flags") return "Flags";
  if (c === "volume") return "Volume";
  if (c === "risk") return "Risk";
  if (c === "regime") return "Regime";
  return "Execution";
}

function maxHoldDaysForStrategy(strategyVersion: string) {
  return strategyVersion === "v1_trend_hold" ? 45 : 7;
}

function tpModelForStrategy(strategyVersion: string) {
  return strategyVersion === "v1_trend_hold" ? "percent_10_20" : "percent_5_10";
}

function strategyName(strategyVersion: string) {
  return strategyVersion === "v1_trend_hold" ? "Trend Hold" : "Momentum Swing";
}

type TpPlan = "none" | "tp1_only" | "tp1_tp2";

function defaultTpPercents(strategyVersion: string) {
  return strategyVersion === "v1_trend_hold"
    ? { tp1Pct: 10, tp2Pct: 20 }
    : { tp1Pct: 5, tp2Pct: 10 };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseNullableNumber(input: string): number | null {
  const v = input.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function Toast({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-[10001]">
      <div className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">
        {msg}
      </div>
    </div>
  );
}

function Modal({
  open,
  title,
  subtitle,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999]"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* pin near top so you don't "lose" it */}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-4 pt-10">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className="pointer-events-auto relative z-[10000] flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <div className="text-base font-semibold text-slate-900">{title}</div>
              {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
            </div>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50"
              onClick={onClose}
            >
              Close
            </button>
          </div>

          <div className="max-h-[80vh] overflow-y-auto overscroll-contain p-4 pr-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs font-medium text-slate-500">{k}</div>
      <div className="text-sm font-semibold text-slate-900">{v}</div>
    </div>
  );
}

export default function ScanTableClient({
  rows,
  scanDate,
  strategyVersion = "v2_core_momentum",
  lastCompletedTradingDay,
}: {
  rows: Row[];
  scanDate: string;
  strategyVersion?: string;
  lastCompletedTradingDay?: string;
}) {
  const [filter, setFilter] = useState<"BUY+WATCH" | "BUY" | "WATCH" | "AVOID" | "ALL">("BUY+WATCH");

  const [quotes, setQuotes] = useState<Record<string, QuoteValue>>({});
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalJson, setModalJson] = useState<any>(null);
  const [modalKind, setModalKind] = useState<"CALC" | "OPEN" | "WHY" | "GENERIC">("GENERIC");
  const [modalBusy, setModalBusy] = useState(false);
  const [calcBySymbol, setCalcBySymbol] = useState<Record<string, any>>({});
  const [ticketSymbol, setTicketSymbol] = useState<string | null>(null);
  const [ticketShares, setTicketShares] = useState<string>("");
  const [ticketEntry, setTicketEntry] = useState<string>("");
  const [ticketStop, setTicketStop] = useState<string>("");
  const [ticketTpPlan, setTicketTpPlan] = useState<TpPlan>("tp1_tp2");
  const [ticketTp1Pct, setTicketTp1Pct] = useState<string>("");
  const [ticketTp2Pct, setTicketTp2Pct] = useState<string>("");
  const [ticketTp1Price, setTicketTp1Price] = useState<string>("");
  const [ticketTp2Price, setTicketTp2Price] = useState<string>("");
  const [ticketTp1SizePct, setTicketTp1SizePct] = useState<string>("");
  const [ticketTp2SizePct, setTicketTp2SizePct] = useState<string>("");
  const [ticketEntryFee, setTicketEntryFee] = useState<string>("");
  const [staleOpenConfirmed, setStaleOpenConfirmed] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [whyFailuresOnly, setWhyFailuresOnly] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  }

  const staleScan = !!lastCompletedTradingDay && scanDate < lastCompletedTradingDay;

  const effectiveRows = useMemo<DisplayRow[]>(() => {
    const r = rows ?? [];
    return r.map((row) => {
      const sym = (row.symbol ?? "").trim().toUpperCase();
      const quote = quotes[sym];
      const live = quote && typeof quote.price === "number" ? quote.price : null;
      const liveSource = quote?.source ?? null;
      const entry = Number(row.entry);
      const divergencePct = computeDivergencePct(Number.isFinite(entry) ? entry : null, live);
      const atr14 = extractAtr14FromReasonJson(row);
      const baseExecution = computeExecutionGuidance({
        signal: row.signal,
        idealEntry: Number(row.entry),
        stop: Number(row.stop),
        live,
        atr: atr14,
        confidence: Number(row.confidence),
        strategyVersion,
      });
      const priceMismatch = baseExecution.flags.priceMismatch;
      const effectiveSignal =
        priceMismatch && (row.signal === "BUY" || row.signal === "WATCH") ? "AVOID" : row.signal;
      const execution =
        effectiveSignal === row.signal
          ? baseExecution
          : computeExecutionGuidance({
              signal: effectiveSignal,
              idealEntry: Number(row.entry),
              stop: Number(row.stop),
              live,
              atr: atr14,
              confidence: Number(row.confidence),
              strategyVersion,
            });
      const eventRisk = Boolean(row?.reason_json?.flags?.event_risk);
      const newsRisk = Boolean(row?.reason_json?.flags?.news_risk);
      return {
        ...row,
        effectiveSignal,
        livePrice: live,
        liveSource,
        divergencePct,
        priceMismatch,
        atr14,
        execution,
        staleScan,
        eventRisk,
        newsRisk,
      };
    });
  }, [rows, quotes, strategyVersion, staleScan]);

  const counts = useMemo(() => {
    const r = effectiveRows ?? [];
    return {
      total: r.length,
      buy: r.filter((x) => x.effectiveSignal === "BUY").length,
      watch: r.filter((x) => x.effectiveSignal === "WATCH").length,
      avoid: r.filter((x) => x.effectiveSignal === "AVOID").length,
      buyWatch: r.filter((x) => x.effectiveSignal === "BUY" || x.effectiveSignal === "WATCH").length,
    };
  }, [effectiveRows]);

  useEffect(() => {
    if (filter === "BUY+WATCH" && counts.buyWatch === 0 && counts.total > 0) {
      setFilter("ALL");
    }
  }, [filter, counts.buyWatch, counts.total]);

  const filtered = useMemo(() => {
    const r = effectiveRows ?? [];
    if (filter === "ALL") return r;
    if (filter === "BUY+WATCH") return r.filter((x) => x.effectiveSignal === "BUY" || x.effectiveSignal === "WATCH");
    return r.filter((x) => x.effectiveSignal === filter);
  }, [effectiveRows, filter]);

  const countsShown = useMemo(() => {
    const r = effectiveRows ?? [];
    return {
      showing: filtered.length,
      buy: r.filter((x) => x.effectiveSignal === "BUY").length,
      watch: r.filter((x) => x.effectiveSignal === "WATCH").length,
      avoid: r.filter((x) => x.effectiveSignal === "AVOID").length,
    };
  }, [effectiveRows, filtered]);

  const symbolsToQuote = useMemo(() => {
    const syms = filtered.map((r) => (r.symbol ?? "").trim().toUpperCase()).filter(Boolean);
    return Array.from(new Set(syms)).slice(0, 50);
  }, [filtered]);

  const ticketRow = useMemo(() => {
    const sym = (ticketSymbol ?? "").trim().toUpperCase();
    if (!sym) return null;
    return effectiveRows.find((r) => (r.symbol ?? "").trim().toUpperCase() === sym) ?? null;
  }, [ticketSymbol, effectiveRows]);

  async function refreshQuotes() {
    if (symbolsToQuote.length === 0) return;
    try {
      setQuoteBusy(true);
      setQuoteError(null);

      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols: symbolsToQuote }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Quote fetch failed.");

      setQuotes((prev) => ({ ...prev, ...(json.quotes ?? {}) }));
      setLastUpdatedAt(Date.now());
    } catch (e: any) {
      setQuoteError(e?.message ?? "Quote fetch failed.");
    } finally {
      setQuoteBusy(false);
    }
  }

  useEffect(() => {
    refreshQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => refreshQuotes(), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, symbolsToQuote.join("|")]);

  function openModal(kind: typeof modalKind, title: string, payload: any, subtitle?: string) {
    setModalKind(kind);
    setModalTitle(title);
    setModalSubtitle(subtitle);
    setModalJson(payload);
    setModalOpen(true);
  }

  async function doCalc(row: DisplayRow | Row) {
    setModalBusy(true);
    showToast(`Calc: ${row.symbol}`);
    try {
      const res = await fetch("/api/position-size", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          entry: row.entry,
          stop: row.stop,
        }),
      });
      const json = await res.json().catch(() => null);
      const calc = extractCalcMetrics(json, { entry: row.entry, stop: row.stop });
      const liveForTicket =
        "livePrice" in row && typeof row.livePrice === "number" && Number.isFinite(row.livePrice)
          ? row.livePrice
          : null;
      setTicketSymbol(row.symbol);
      const defaultShares =
        calc.shares !== null && Number.isFinite(calc.shares) ? Math.max(0, Math.floor(calc.shares)) : 0;
      setTicketShares(String(defaultShares));
      setTicketEntry(
        liveForTicket !== null
          ? Number(liveForTicket).toFixed(2)
          : calc.entry !== null
            ? calc.entry.toFixed(2)
            : Number(row.entry).toFixed(2)
      );
      setTicketStop(calc.stop !== null ? calc.stop.toFixed(2) : Number(row.stop).toFixed(2));
      const defaults = defaultTpPercents(strategyVersion);
      const entryForTp = Number(
        liveForTicket !== null
          ? liveForTicket
          : calc.entry !== null
            ? calc.entry
            : Number(row.entry)
      );
      setTicketTpPlan("tp1_tp2");
      setTicketTp1Pct(String(defaults.tp1Pct));
      setTicketTp2Pct(String(defaults.tp2Pct));
      setTicketTp1Price(Number.isFinite(entryForTp) ? (entryForTp * (1 + defaults.tp1Pct / 100)).toFixed(2) : "");
      setTicketTp2Price(Number.isFinite(entryForTp) ? (entryForTp * (1 + defaults.tp2Pct / 100)).toFixed(2) : "");
      setTicketTp1SizePct("50");
      setTicketTp2SizePct("50");
      setTicketEntryFee(
        calc.defaultFeePerOrder !== null && Number.isFinite(calc.defaultFeePerOrder)
          ? calc.defaultFeePerOrder.toFixed(2)
          : ""
      );
      setStaleOpenConfirmed(false);
      setTicketError(null);
      if (json?.ok) {
        setCalcBySymbol((prev) => ({ ...prev, [row.symbol]: json }));
      }
      openModal("CALC", `Position sizing: ${row.symbol}`, json ?? { ok: false, error: "No response" }, "Uses your active portfolio risk settings.");
    } catch (e: any) {
      openModal("CALC", `Position sizing: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
    } finally {
      setModalBusy(false);
    }
  }

  async function doOpen(row: DisplayRow | Row) {
    await doCalc(row);
  }

  async function doDetails(row: DisplayRow | Row) {
    setModalBusy(true);
    setWhyFailuresOnly(false);
    showToast(`Details: ${row.symbol}`);
    try {
      const res = await fetch("/api/why", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          date: scanDate,
          universe_slug: "core_800",
          strategy_version: strategyVersion,
        }),
      });
      const json = await res.json().catch(() => null);
      const rowAny = row as any;
      const rowDivergence =
        typeof rowAny?.divergencePct === "number" && Number.isFinite(rowAny?.divergencePct)
          ? rowAny.divergencePct
          : null;
      const rowMismatch = !!rowAny?.priceMismatch;
      const rowStale = !!rowAny?.staleScan;
      const merged =
        json && typeof json === "object"
          ? {
              ...json,
              row: json?.row
                ? {
                    ...json.row,
                    reason_json: {
                      ...(json.row.reason_json ?? {}),
                      execution_flags: {
                        ...((json.row.reason_json as any)?.execution_flags ?? {}),
                        stale_scan: rowStale,
                        scan_date: scanDate,
                        last_completed_trading_day: lastCompletedTradingDay ?? null,
                        price_mismatch: rowMismatch,
                        divergence_pct: rowDivergence,
                      },
                    },
                  }
                : json?.row,
            }
          : json;
      openModal("WHY", `Why: ${row.symbol}`, merged ?? { ok: false, error: "No response" });
    } catch (e: any) {
      openModal("WHY", `Why: ${row.symbol}`, { ok: false, error: e?.message ?? "Failed" });
    } finally {
      setModalBusy(false);
    }
  }

  async function submitTicketOpen() {
    const symbol = (ticketSymbol ?? "").trim().toUpperCase();
    const shares = Math.floor(Number(ticketShares));
    const entryPrice = Number(ticketEntry);
    const stopPrice = Number(ticketStop);

    if (!symbol) {
      setTicketError("Symbol is missing. Re-open the ticket from a row.");
      return;
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      setTicketError("Shares must be a positive integer.");
      return;
    }
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      setTicketError("Entry price must be a positive number.");
      return;
    }
    if (!Number.isFinite(stopPrice) || stopPrice <= 0 || stopPrice >= entryPrice) {
      setTicketError("Stop must be positive and strictly below entry.");
      return;
    }
    const tp1PctInput = parseNullableNumber(ticketTp1Pct);
    const tp2PctInput = parseNullableNumber(ticketTp2Pct);
    const tp1PriceInput = parseNullableNumber(ticketTp1Price);
    const tp2PriceInput = parseNullableNumber(ticketTp2Price);
    const tp1SizeInput = parseNullableNumber(ticketTp1SizePct);
    const tp2SizeInput = parseNullableNumber(ticketTp2SizePct);
    const tp1SizePct =
      tp1SizeInput === null ? null : Math.round(tp1SizeInput);
    const tp2SizePct =
      tp2SizeInput === null ? null : Math.round(tp2SizeInput);
    const plan = ticketTpPlan;
    const entryFee = Number(ticketEntryFee);
    let finalTp1Pct: number | null = null;
    let finalTp2Pct: number | null = null;
    let finalTp1Price: number | null = null;
    let finalTp2Price: number | null = null;
    let finalTp1SizePct: number | null = null;
    let finalTp2SizePct: number | null = null;

    if (plan === "none") {
      finalTp1Pct = null;
      finalTp2Pct = null;
      finalTp1Price = null;
      finalTp2Price = null;
      finalTp1SizePct = null;
      finalTp2SizePct = null;
    } else {
      if (tp1PriceInput !== null) {
        const derivedPct = round1(((tp1PriceInput / entryPrice) - 1) * 100);
        if (derivedPct <= 0 || tp1PriceInput <= entryPrice) {
          setTicketError("TP1 must be above entry.");
          return;
        }
        finalTp1Pct = derivedPct;
        finalTp1Price = round2(tp1PriceInput);
      } else if (tp1PctInput !== null) {
        if (tp1PctInput <= 0) {
          setTicketError("TP1 must be above entry.");
          return;
        }
        finalTp1Pct = round1(tp1PctInput);
        finalTp1Price = round2(entryPrice * (1 + finalTp1Pct / 100));
      } else {
        setTicketError("TP1 % or TP1 price must be provided.");
        return;
      }
    }

    if (plan === "tp1_only") {
      finalTp1SizePct = tp1SizePct ?? 100;
      finalTp2SizePct = 0;
    }

    if (plan === "tp1_tp2") {
      if (tp2PriceInput !== null) {
        const derivedPct = round1(((tp2PriceInput / entryPrice) - 1) * 100);
        if (derivedPct <= 0 || tp2PriceInput <= entryPrice) {
          setTicketError("TP2 must be above entry.");
          return;
        }
        finalTp2Pct = derivedPct;
        finalTp2Price = round2(tp2PriceInput);
      } else if (tp2PctInput !== null) {
        if (tp2PctInput <= 0) {
          setTicketError("TP2 must be above entry.");
          return;
        }
        finalTp2Pct = round1(tp2PctInput);
        finalTp2Price = round2(entryPrice * (1 + finalTp2Pct / 100));
      } else {
        setTicketError("TP2 % or TP2 price must be provided.");
        return;
      }

      if (tp1SizePct === null || tp1SizePct < 0 || tp1SizePct > 100) {
        setTicketError("TP1 size % must be between 0 and 100.");
        return;
      }
      if (tp2SizePct === null || tp2SizePct < 0 || tp2SizePct > 100) {
        setTicketError("TP2 size % must be between 0 and 100.");
        return;
      }
      if (tp1SizePct + tp2SizePct !== 100) {
        setTicketError("TP1 size % + TP2 size % must sum to 100.");
        return;
      }
      finalTp1SizePct = tp1SizePct;
      finalTp2SizePct = tp2SizePct;
    }

    if ((plan === "tp1_only" || plan === "tp1_tp2") && (finalTp1SizePct === null || finalTp1SizePct < 0 || finalTp1SizePct > 100)) {
      setTicketError("TP1 size % must be between 0 and 100.");
      return;
    }
    if (ticketEntryFee.trim() && (!Number.isFinite(entryFee) || entryFee < 0)) {
      setTicketError("Entry fee must be blank or >= 0.");
      return;
    }
    if (staleScan && !staleOpenConfirmed) {
      setTicketError("Scan is stale. Confirm stale open before submitting.");
      return;
    }

    setTicketSubmitting(true);
    setTicketError(null);
    try {
      const calc = extractCalcMetrics(modalJson);
      const maxHoldDays = maxHoldDaysForStrategy(strategyVersion);
      const tpModel = tpModelForStrategy(strategyVersion);
      const equitySnapshot =
        calc.cashAvailable !== null || calc.equity !== null || calc.investedValue !== null
          ? {
              cash_available: calc.cashAvailable,
              invested_value: calc.investedValue,
              equity: calc.equity,
            }
          : null;
      const res = await fetch("/api/positions/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          entry_price: parseFloat(entryPrice.toString()),
          stop: parseFloat(stopPrice.toString()),
          shares: parseFloat(shares.toString()),
          strategy_version: strategyVersion,
          max_hold_days: maxHoldDays,
          tp_model: tpModel,
          tp_plan: plan,
          tp1_pct: finalTp1Pct,
          tp2_pct: finalTp2Pct,
          tp1_price: finalTp1Price,
          tp2_price: finalTp2Price,
          tp1_size_pct: finalTp1SizePct,
          tp2_size_pct: finalTp2SizePct,
          entry_fee: ticketEntryFee.trim() ? entryFee : null,
          equity_snapshot: equitySnapshot,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const detail = json?.detail ? ` (${JSON.stringify(json.detail)})` : "";
        setTicketError(`${json?.error ?? "Open failed"}${detail}`);
        return;
      }

      setModalOpen(false);
      showToast("Position opened ✅");
    } catch (e: any) {
      setTicketError(e?.message ?? "Open failed");
    } finally {
      setTicketSubmitting(false);
    }
  }

  function renderModalBody() {
    const j = modalJson ?? {};
    const ok = !!j?.ok;
    const err = j?.error ?? j?.message ?? null;

    if (!ok) {
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <div className="font-semibold">Action failed</div>
            <div className="mt-1">{String(err ?? "Unknown error")}</div>
          </div>

          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(j, null, 2)}
            </pre>
          </details>
        </div>
      );
    }

    if (modalKind === "CALC") {
      const calc = extractCalcMetrics(j);
      const sharesNum = Math.floor(Number(ticketShares));
      const entryNum = Number(ticketEntry);
      const stopNum = Number(ticketStop);
      const liveForTicket = Number.isFinite(entryNum) ? entryNum : null;
      const execution = computeExecutionGuidance({
        signal: ticketRow?.effectiveSignal ?? "WATCH",
        idealEntry: Number(ticketRow?.entry ?? calc.entry ?? entryNum),
        stop: stopNum,
        live: liveForTicket,
        atr: ticketRow?.atr14 ?? null,
        confidence: Number(ticketRow?.confidence ?? 0),
        strategyVersion,
      });
      const riskPerShare = Number.isFinite(entryNum) && Number.isFinite(stopNum) ? entryNum - stopNum : null;
      const stopTooWide = execution.flags.stopTooWide;
      const maxHoldDays = maxHoldDaysForStrategy(strategyVersion);
      const entryDate = new Date(scanDate);
      const timeStopDate = new Date(entryDate);
      timeStopDate.setDate(entryDate.getDate() + maxHoldDays);
      const riskUsed = Number.isFinite(sharesNum) && riskPerShare !== null ? sharesNum * riskPerShare : null;
      const positionCost = Number.isFinite(sharesNum) && Number.isFinite(entryNum) ? sharesNum * entryNum : null;
      const cashAvailable =
        calc.cashAvailable !== null ? calc.cashAvailable : calc.accountSize !== null ? calc.accountSize : null;
      const investedValue = calc.investedValue !== null ? calc.investedValue : null;
      const equity =
        calc.equity !== null
          ? calc.equity
          : cashAvailable !== null && investedValue !== null
            ? cashAvailable + investedValue
            : calc.accountSize;
      const riskBudget =
        equity !== null && calc.riskPct !== null
          ? equity * (calc.riskPct / 100)
          : calc.maxRiskUsd !== null
            ? calc.maxRiskUsd
            : null;
      const sharesByRisk =
        calc.sharesByRisk !== null
          ? Math.max(0, Math.floor(calc.sharesByRisk))
          : riskBudget !== null && riskPerShare !== null && riskPerShare > 0
            ? Math.max(0, Math.floor(riskBudget / riskPerShare))
            : null;
      const sharesByCash =
        calc.sharesByCash !== null
          ? Math.max(0, Math.floor(calc.sharesByCash))
          : cashAvailable !== null && Number.isFinite(entryNum) && entryNum > 0
            ? Math.max(0, Math.floor(cashAvailable / entryNum))
            : null;
      const cashLimited =
        sharesByRisk !== null && sharesByCash !== null && sharesByCash < sharesByRisk;
      const exceedsCash =
        sharesByCash !== null && Number.isFinite(sharesNum) && sharesNum > sharesByCash;
      const cashRemainingAfter =
        cashAvailable !== null && positionCost !== null ? cashAvailable - positionCost : null;

      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${actionPill(execution.action)}`}>
                {actionLabel(execution.action)}
              </span>
              {execution.reasons[0] ? (
                <span className="text-xs text-slate-600">{execution.reasons[0]}</span>
              ) : null}
              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                {strategyName(strategyVersion)}
              </span>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Shares</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={ticketShares}
                onChange={(e) => setTicketShares(e.target.value)}
                inputMode="numeric"
                disabled={ticketSubmitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Entry price</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={ticketEntry}
                onChange={(e) => setTicketEntry(e.target.value)}
                inputMode="decimal"
                disabled={ticketSubmitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Stop price</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={ticketStop}
                onChange={(e) => setTicketStop(e.target.value)}
                inputMode="decimal"
                disabled={ticketSubmitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Entry fee (USD)</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={ticketEntryFee}
                onChange={(e) => setTicketEntryFee(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                disabled={ticketSubmitting}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Take Profit Plan</div>
            <div className="text-[11px] text-slate-500">Based on entry: {Number.isFinite(Number(ticketEntry)) ? fmt2(Number(ticketEntry)) : "—"}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-3">
                <label className="text-xs text-slate-500">Plan</label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  value={ticketTpPlan}
                  onChange={(e) => {
                    const next = e.target.value as TpPlan;
                    const defaults = defaultTpPercents(strategyVersion);
                    setTicketTpPlan(next);
                    if (next === "tp1_only") {
                      setTicketTp1Pct(String(defaults.tp1Pct));
                      setTicketTp1Price(
                        Number.isFinite(Number(ticketEntry))
                          ? (Number(ticketEntry) * (1 + defaults.tp1Pct / 100)).toFixed(2)
                          : ""
                      );
                      setTicketTp1SizePct("100");
                      setTicketTp2Pct("");
                      setTicketTp2Price("");
                      setTicketTp2SizePct("0");
                    } else if (next === "tp1_tp2") {
                      setTicketTp1Pct(String(defaults.tp1Pct));
                      setTicketTp2Pct(String(defaults.tp2Pct));
                      setTicketTp1Price(
                        Number.isFinite(Number(ticketEntry))
                          ? (Number(ticketEntry) * (1 + defaults.tp1Pct / 100)).toFixed(2)
                          : ""
                      );
                      setTicketTp2Price(
                        Number.isFinite(Number(ticketEntry))
                          ? (Number(ticketEntry) * (1 + defaults.tp2Pct / 100)).toFixed(2)
                          : ""
                      );
                      setTicketTp1SizePct("50");
                      setTicketTp2SizePct("50");
                    } else {
                      setTicketTp1Pct("");
                      setTicketTp2Pct("");
                      setTicketTp1Price("");
                      setTicketTp2Price("");
                      setTicketTp1SizePct("");
                      setTicketTp2SizePct("");
                    }
                  }}
                  disabled={ticketSubmitting}
                >
                  <option value="none">None</option>
                  <option value="tp1_only">TP1 only</option>
                  <option value="tp1_tp2">TP1+TP2</option>
                </select>
              </div>

              {ticketTpPlan === "tp1_only" || ticketTpPlan === "tp1_tp2" ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP1 %</label>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      value={ticketTp1Pct}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTicketTp1Pct(v);
                        const entry = Number(ticketEntry);
                        const pct = Number(v);
                        if (Number.isFinite(entry) && entry > 0 && Number.isFinite(pct) && pct > 0) {
                          setTicketTp1Price((entry * (1 + pct / 100)).toFixed(2));
                        }
                      }}
                      inputMode="decimal"
                      disabled={ticketSubmitting}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP1 price</label>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      value={ticketTp1Price}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTicketTp1Price(v);
                        const entry = Number(ticketEntry);
                        const price = Number(v);
                        if (Number.isFinite(entry) && entry > 0 && Number.isFinite(price) && price > 0) {
                          setTicketTp1Pct(round1(((price / entry) - 1) * 100).toFixed(1));
                        }
                      }}
                      inputMode="decimal"
                      disabled={ticketSubmitting}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP1 size %</label>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      value={ticketTp1SizePct}
                      onChange={(e) => setTicketTp1SizePct(e.target.value)}
                      inputMode="numeric"
                      disabled={ticketSubmitting}
                    />
                  </div>
                </>
              ) : null}

              {ticketTpPlan === "tp1_tp2" ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP2 %</label>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      value={ticketTp2Pct}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTicketTp2Pct(v);
                        const entry = Number(ticketEntry);
                        const pct = Number(v);
                        if (Number.isFinite(entry) && entry > 0 && Number.isFinite(pct) && pct > 0) {
                          setTicketTp2Price((entry * (1 + pct / 100)).toFixed(2));
                        }
                      }}
                      inputMode="decimal"
                      disabled={ticketSubmitting}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP2 price</label>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      value={ticketTp2Price}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTicketTp2Price(v);
                        const entry = Number(ticketEntry);
                        const price = Number(v);
                        if (Number.isFinite(entry) && entry > 0 && Number.isFinite(price) && price > 0) {
                          setTicketTp2Pct(round1(((price / entry) - 1) * 100).toFixed(1));
                        }
                      }}
                      inputMode="decimal"
                      disabled={ticketSubmitting}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP2 size %</label>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      value={ticketTp2SizePct}
                      onChange={(e) => setTicketTp2SizePct(e.target.value)}
                      inputMode="numeric"
                      disabled={ticketSubmitting}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <KV k="Suggested shares" v={calc.shares !== null ? String(Math.floor(calc.shares)) : "—"} />
            <KV k="Cash" v={cashAvailable !== null ? fmtMoney(cashAvailable) : "—"} />
            <KV k="Invested" v={investedValue !== null ? fmtMoney(investedValue) : "—"} />
            <KV k="Equity" v={equity !== null ? fmtMoney(equity) : "—"} />
            <KV
              k="Risk/trade %"
              v={calc.riskPct !== null ? `${calc.riskPct.toFixed(2)}%` : "—"}
            />
            <KV k="Risk budget (USD)" v={riskBudget !== null ? fmtMoney(riskBudget) : "—"} />
            <KV k="Shares by risk" v={sharesByRisk !== null ? String(sharesByRisk) : "—"} />
            <KV k="Shares by cash" v={sharesByCash !== null ? String(sharesByCash) : "—"} />
            <KV k="Risk/share" v={riskPerShare !== null ? fmtMoney(riskPerShare) : "—"} />
            <KV
              k={strategyVersion === "v1_trend_hold" ? "TP1 (10%)" : "TP1 (5%)"}
              v={Number.isFinite(execution.tp1) ? fmt2(execution.tp1) : "—"}
            />
            <KV
              k={strategyVersion === "v1_trend_hold" ? "TP2 (20%)" : "TP2 (10%)"}
              v={Number.isFinite(execution.tp2) ? fmt2(execution.tp2) : "—"}
            />
            <KV k="Risk used" v={riskUsed !== null ? fmtMoney(riskUsed) : "—"} />
            <KV k="Position cost" v={positionCost !== null ? fmtMoney(positionCost) : "—"} />
            <KV k="Cash after open" v={cashRemainingAfter !== null ? fmtMoney(cashRemainingAfter) : "—"} />
            <KV k="Expected hold" v={strategyVersion === "v1_trend_hold" ? "3-8w" : "3-7d"} />
            <KV k="Max hold (days)" v={String(maxHoldDays)} />
            <KV k="Time-stop date" v={fmtDate(timeStopDate)} />
          </div>

          {stopTooWide ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <span className="font-semibold">Risk too wide for % system.</span>
            </div>
          ) : null}

          {staleScan ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <div className="font-semibold">STALE (run rescan)</div>
              <div className="mt-1">
                Scan date {scanDate} is behind last completed trading day {lastCompletedTradingDay ?? "—"}.
              </div>
              <label className="mt-2 inline-flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={staleOpenConfirmed}
                  onChange={(e) => setStaleOpenConfirmed(e.target.checked)}
                  disabled={ticketSubmitting}
                />
                Confirm open anyway
              </label>
            </div>
          ) : null}

          {cashLimited ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span className="font-semibold">Cash-limited</span>: risk sizing suggests{" "}
              <span className="font-mono">{sharesByRisk}</span> shares, but cash allows{" "}
              <span className="font-mono">{sharesByCash}</span>.
            </div>
          ) : null}

          {exceedsCash ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span className="font-semibold">Exceeds available cash.</span>{" "}
              This is allowed (soft constraint). Estimated cash after open:{" "}
              <span className="font-mono">{cashRemainingAfter !== null ? fmtMoney(cashRemainingAfter) : "—"}</span>
            </div>
          ) : null}

          {ticketError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {ticketError}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={submitTicketOpen} disabled={ticketSubmitting || stopTooWide || (staleScan && !staleOpenConfirmed)}>
              {ticketSubmitting ? "Opening..." : "Open position"}
            </Button>
          </div>

          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(j, null, 2)}
            </pre>
          </details>
        </div>
      );
    }

    if (modalKind === "WHY") {
      const why = j?.row ?? j;
      const summary = why?.reason_summary ?? why?.summary ?? null;
      const checks = why?.reason_json?.checks ?? why?.checks ?? null;
      const indicators = why?.reason_json?.indicators ?? {};
      const groupedChecks: Record<CheckCategory, any[]> = CHECK_CATEGORY_ORDER.reduce(
        (acc, k) => ({ ...acc, [k]: [] }),
        {} as Record<CheckCategory, any[]>
      );
      if (Array.isArray(checks)) {
        for (const c of checks) {
          const cat = categoryForCheck(c);
          groupedChecks[cat].push(c);
        }
      }
      const visibleByCategory = CHECK_CATEGORY_ORDER.map((cat) => ({
        cat,
        items: whyFailuresOnly ? groupedChecks[cat].filter((x) => !x?.ok) : groupedChecks[cat],
      })).filter((x) => x.items.length > 0);

      const volSpike = asNumber(indicators?.volumeSpike);
      const metricChips = [
        { label: "RSI", value: fmt2(asNumber(indicators?.rsi14)) },
        { label: "ATR", value: fmt2(asNumber(indicators?.atr14)) },
        { label: "Vol", value: volSpike !== null ? `${fmt2(volSpike)}x` : "—" },
        { label: "Dist SMA20", value: fmt2(asNumber(indicators?.distFromSma20)) },
        { label: "Dist ATR", value: fmt2(asNumber(indicators?.distInAtr)) },
        { label: "Dollar Vol", value: fmtCompact(asNumber(indicators?.avgDollarVolume20)) },
      ];

      return (
        <div className="space-y-3">
          {summary ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              <div className="text-xs text-slate-500">Why summary</div>
              <div className="mt-1 font-semibold">{String(summary)}</div>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">Checks</div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={whyFailuresOnly}
                onChange={(e) => setWhyFailuresOnly(e.target.checked)}
              />
              Only show failures
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {metricChips.map((m) => (
              <span
                key={m.label}
                className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
              >
                {m.label}: {m.value}
              </span>
            ))}
          </div>

          {Array.isArray(checks) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mt-2 space-y-3">
                {visibleByCategory.map(({ cat, items }) => (
                  <div key={cat} className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {categoryLabel(cat)}
                    </div>
                    <ul className="space-y-2 pl-4 list-disc">
                      {items.map((c: any, idx: number) => (
                        <li key={`${cat}-${idx}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">
                              {c?.label ?? "Check"}
                              {c?.detail ? <span className="ml-1 text-xs text-slate-500">({String(c.detail)})</span> : null}
                            </div>
                            <div
                              className={clsx(
                                "text-xs font-semibold",
                                c?.ok ? "text-emerald-600" : "text-rose-600"
                              )}
                            >
                              {c?.ok ? "✓ PASS" : "✕ FAIL"}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(j, null, 2)}
            </pre>
          </details>
        </div>
      );
    }

    // OPEN + generic
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <div className="font-semibold">Success</div>
          <div className="mt-1">Action completed.</div>
        </div>

        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Raw response</summary>
          <pre className="mt-2 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(j, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toast ? <Toast msg={toast} /> : null}

      <div className="flex flex-wrap gap-2">
        <button className={chipClass(filter === "BUY+WATCH")} onClick={() => setFilter("BUY+WATCH")}>
          BUY + WATCH
        </button>
        <button className={chipClass(filter === "BUY")} onClick={() => setFilter("BUY")}>
          BUY
        </button>
        <button className={chipClass(filter === "WATCH")} onClick={() => setFilter("WATCH")}>
          WATCH
        </button>
        <button className={chipClass(filter === "AVOID")} onClick={() => setFilter("AVOID")}>
          AVOID
        </button>
        <button className={chipClass(filter === "ALL")} onClick={() => setFilter("ALL")}>
          ALL
        </button>
      </div>

      <div className="text-sm muted">
        Confidence is a 0–100 score from strict momentum continuation checks: trend alignment, RSI band, volume confirmation, extension control, and regime gating.
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">SHOWING</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{fmtInt(countsShown.showing)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">BUY</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{fmtInt(countsShown.buy)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">WATCH</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{fmtInt(countsShown.watch)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">AVOID</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{fmtInt(countsShown.avoid)}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            Live prices overlay (signals remain daily). <span className="text-slate-400">Scan date: {scanDate}</span>
            {lastUpdatedAt ? (
              <span className="ml-2 text-slate-400">Updated: {new Date(lastUpdatedAt).toLocaleTimeString()}</span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                auto ? "border-slate-300 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
              }`}
              onClick={() => setAuto((v) => !v)}
              disabled={quoteBusy}
            >
              Auto
            </button>

            <Button variant="secondary" onClick={refreshQuotes} disabled={quoteBusy || symbolsToQuote.length === 0}>
              {quoteBusy ? "Refreshing..." : "Refresh prices"}
            </Button>
          </div>
        </div>

        {quoteError ? <div className="px-3 py-2 text-xs text-rose-600 border-b border-slate-200">{quoteError}</div> : null}

        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="p-3">SYMBOL</th>
                <th className="p-3">SIGNAL</th>
                <th className="p-3">CONF</th>
                <th className="p-3">ENTRY</th>
                <th className="p-3">LIVE</th>
                <th className="p-3">STOP</th>
                <th className="p-3">TP1 / TP2</th>
                <th className="p-3 text-right">ACTIONS</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={8}>
                    No rows for this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const live = r.livePrice;

                  const lateByPct = r.execution.flags.late ? r.execution.extensionPct * 100 : 0;
                  const isExtended =
                    (r.execution.extensionAtr !== null && r.execution.extensionAtr > 1.5) ||
                    r.execution.extensionPct >= 0.08;
                  const notes: string[] = [];
                  if (lateByPct > 0) notes.push(`Late by +${lateByPct.toFixed(1)}%`);
                  if (isExtended) notes.push("Extended");
                  if (r.execution.flags.stopVeryWide && !r.execution.flags.stopTooWide) notes.push("Stop very wide");
                  if (live === null) notes.push("No live");
                  notes.push(strategyVersion === "v1_trend_hold" ? "Hold: 3-8w" : "Hold: 3-7d");

                  return (
                    <tr key={r.symbol} className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-900">{r.symbol}</td>
                      <td className="p-3">
                        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${signalPill(r.effectiveSignal)}`}>
                          {r.effectiveSignal}
                        </span>
                        {r.staleScan ? (
                          <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                            STALE (run rescan)
                          </span>
                        ) : null}
                        {r.priceMismatch ? (
                          <span className="ml-2 rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">
                            PRICE MISMATCH
                          </span>
                        ) : null}
                        {r.eventRisk ? (
                          <span className="ml-2 rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">
                            EVENT RISK
                          </span>
                        ) : null}
                        {r.newsRisk ? (
                          <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                            NEWS RISK
                          </span>
                        ) : null}
                        <span className={`ml-2 rounded-full border px-2 py-1 text-[10px] font-semibold ${actionPill(r.execution.action)}`}>
                          {actionLabel(r.execution.action)}
                        </span>
                        {r.execution.flags.stopTooWide ? (
                          <span className="ml-2 rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">
                            STOP TOO WIDE
                          </span>
                        ) : null}
                        {notes.length > 0 ? (
                          <div className="mt-1 text-[10px] text-slate-500">{notes.join(" • ")}</div>
                        ) : null}
                      </td>
                      <td className="p-3 text-slate-800 font-semibold">{r.confidence}</td>
                      <td className="p-3 text-slate-800">{fmt2(Number(r.entry))}</td>
                      <td className="p-3 text-slate-800">
                        {typeof live === "number" ? fmt2(live) : "—"}
                        {typeof live === "number" && r.liveSource === "eod_close" ? (
                          <span className="ml-2 rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700">
                            EOD
                          </span>
                        ) : null}
                      </td>
                      <td className="p-3 text-slate-800">{fmt2(Number(r.stop))}</td>
                      <td className="p-3 text-slate-800">
                        {fmt2(r.execution.tp1)} / {fmt2(r.execution.tp2)}
                      </td>

                      <td className="p-3">
                        <div className="flex justify-end gap-2 whitespace-nowrap">
                          <Button variant="secondary" onClick={() => doCalc(r)} disabled={modalBusy}>
                            Calc
                          </Button>
                          <Button onClick={() => doOpen(r)} disabled={modalBusy}>
                            Open
                          </Button>
                          <Button variant="secondary" onClick={() => doDetails(r)} disabled={modalBusy}>
                            Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 text-xs text-slate-500">
          Tip: On mobile, swipe sideways to see all columns. Live data may be delayed depending on your Polygon plan.
        </div>
      </div>

      <Modal
        open={modalOpen}
        title={modalTitle}
        subtitle={modalSubtitle}
        onClose={() => setModalOpen(false)}
      >
        {renderModalBody()}
      </Modal>
    </div>
  );
}
