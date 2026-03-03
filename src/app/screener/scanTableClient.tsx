"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { computeExecutionGuidance, type ExecutionAction } from "@/lib/execution";

type Row = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  entry: number;
  stop: number;
  reason_json?: any;
};

type DisplayRow = Row & {
  effectiveSignal: "BUY" | "WATCH" | "AVOID";
  livePrice: number | null;
  divergencePct: number | null;
  priceMismatch: boolean;
  atr14: number | null;
  execution: ReturnType<typeof computeExecutionGuidance>;
};

function fmt2(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtMoney(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function fmtPct(p: number | null | undefined) {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${(p * 100).toFixed(1)}%`;
}

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
    riskPct,
    riskPerShare,
    maxRiskUsd,
    positionCost,
  };
}

function categoryForCheck(c: any): "Trend" | "Momentum" | "Volume" | "Extension" | "Regime" {
  const key = String(c?.key ?? "").toLowerCase();
  const label = String(c?.label ?? "").toLowerCase();
  const text = `${key} ${label}`;
  if (text.includes("regime")) return "Regime";
  if (text.includes("volume")) return "Volume";
  if (text.includes("rsi") || text.includes("momentum")) return "Momentum";
  if (text.includes("extend") || text.includes("atr")) return "Extension";
  return "Trend";
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
  if (!open) return null;

  // lock scroll behind modal
  // (simple approach)
  if (typeof document !== "undefined") document.body.style.overflow = "hidden";

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          if (typeof document !== "undefined") document.body.style.overflow = "";
          onClose();
        }}
        aria-hidden="true"
      />
      {/* pin near top so you don't "lose" it */}
      <div className="absolute inset-0 flex items-start justify-center p-4 pt-10">
        <div className="relative z-[10000] w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <div className="text-base font-semibold text-slate-900">{title}</div>
              {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
            </div>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50"
              onClick={() => {
                if (typeof document !== "undefined") document.body.style.overflow = "";
                onClose();
              }}
            >
              Close
            </button>
          </div>

          <div className="p-4 max-h-[70vh] overflow-auto">{children}</div>
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

export default function ScanTableClient({ rows, scanDate }: { rows: Row[]; scanDate: string }) {
  const [filter, setFilter] = useState<"BUY+WATCH" | "BUY" | "WATCH" | "AVOID" | "ALL">("BUY+WATCH");

  const [quotes, setQuotes] = useState<Record<string, number | null>>({});
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
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  }

  const effectiveRows = useMemo<DisplayRow[]>(() => {
    const r = rows ?? [];
    return r.map((row) => {
      const sym = (row.symbol ?? "").trim().toUpperCase();
      const live = typeof quotes[sym] === "number" ? (quotes[sym] as number) : null;
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
            });
      return {
        ...row,
        effectiveSignal,
        livePrice: live,
        divergencePct,
        priceMismatch,
        atr14,
        execution,
      };
    });
  }, [rows, quotes]);

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
    showToast(`Details: ${row.symbol}`);
    try {
      const res = await fetch("/api/why", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: row.symbol,
          date: scanDate,
          universe_slug: "core_800",
          strategy_version: "v2_core_momentum",
        }),
      });
      const json = await res.json().catch(() => null);
      openModal("WHY", `Why: ${row.symbol}`, json ?? { ok: false, error: "No response" });
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

    setTicketSubmitting(true);
    setTicketError(null);
    try {
      const calc = extractCalcMetrics(modalJson);
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
      });
      const riskPerShare = Number.isFinite(entryNum) && Number.isFinite(stopNum) ? entryNum - stopNum : null;
      const stopTooWide = execution.flags.stopTooWide;
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
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
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
            <KV k="TP1 (5%)" v={Number.isFinite(execution.tp1) ? fmt2(execution.tp1) : "—"} />
            <KV k="TP2 (10%)" v={Number.isFinite(execution.tp2) ? fmt2(execution.tp2) : "—"} />
            <KV k="Risk used" v={riskUsed !== null ? fmtMoney(riskUsed) : "—"} />
            <KV k="Position cost" v={positionCost !== null ? fmtMoney(positionCost) : "—"} />
            <KV k="Cash after open" v={cashRemainingAfter !== null ? fmtMoney(cashRemainingAfter) : "—"} />
          </div>

          {stopTooWide ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <span className="font-semibold">Risk too wide for % system.</span>
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
            <Button onClick={submitTicketOpen} disabled={ticketSubmitting || stopTooWide}>
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
      const groupedChecks: Record<string, any[]> = Array.isArray(checks)
        ? checks.reduce((acc: Record<string, any[]>, c: any) => {
            const cat = categoryForCheck(c);
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(c);
            return acc;
          }, {})
        : {};

      return (
        <div className="space-y-3">
          {summary ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              <div className="text-xs text-slate-500">Summary</div>
              <div className="mt-1 font-semibold">{String(summary)}</div>
            </div>
          ) : null}

          {Array.isArray(checks) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-sm font-semibold text-slate-900">Checks</div>
              <div className="mt-2 space-y-3">
                {Object.entries(groupedChecks).map(([group, groupItems]) => (
                  <div key={group} className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</div>
                    <div className="space-y-2">
                      {groupItems.map((c: any, idx: number) => (
                        <div key={`${group}-${idx}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">{c?.label ?? "Check"}</div>
                            <div className={clsx("text-xs font-semibold", c?.ok ? "text-emerald-600" : "text-rose-600")}>
                              {c?.ok ? "✓ PASS" : "✕ FAIL"}
                            </div>
                          </div>
                          {c?.detail ? <div className="mt-1 text-xs text-slate-500">{String(c.detail)}</div> : null}
                        </div>
                      ))}
                    </div>
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
          <div className="mt-1 text-2xl font-semibold text-slate-900">{countsShown.showing}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">BUY</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{countsShown.buy}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">WATCH</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{countsShown.watch}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">AVOID</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{countsShown.avoid}</div>
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
                <th className="p-3">STOP</th>
                <th className="p-3">LIVE</th>
                <th className="p-3">Δ vs ENTRY</th>
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

                  const entry = Number(r.entry);
                  const dEntry = typeof live === "number" && Number.isFinite(live) ? (live - entry) / entry : null;
                  const lateByPct = r.execution.flags.late ? r.execution.extensionPct * 100 : 0;
                  const isExtended =
                    (r.execution.extensionAtr !== null && r.execution.extensionAtr > 1.5) ||
                    r.execution.extensionPct >= 0.08;
                  const notes: string[] = [];
                  if (lateByPct > 0) notes.push(`Late by +${lateByPct.toFixed(1)}%`);
                  if (isExtended) notes.push("Extended");
                  if (live === null) notes.push("No live");

                  const dEntryClass =
                    typeof dEntry === "number"
                      ? dEntry > 0
                        ? "text-emerald-600"
                        : dEntry < 0
                          ? "text-rose-600"
                          : "text-slate-600"
                      : "text-slate-500";

                  return (
                    <tr key={r.symbol} className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-900">{r.symbol}</td>
                      <td className="p-3">
                        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${signalPill(r.effectiveSignal)}`}>
                          {r.effectiveSignal}
                        </span>
                        {r.priceMismatch ? (
                          <span className="ml-2 rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">
                            PRICE MISMATCH
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
                      <td className="p-3 text-slate-800">{Number(r.entry).toFixed(2)}</td>
                      <td className="p-3 text-slate-800">{Number(r.stop).toFixed(2)}</td>

                      <td className="p-3 text-slate-800">{typeof live === "number" ? fmt2(live) : "—"}</td>
                      <td className={clsx("p-3 font-semibold", dEntryClass)}>
                        {typeof dEntry === "number" ? fmtPct(dEntry) : "—"}
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
