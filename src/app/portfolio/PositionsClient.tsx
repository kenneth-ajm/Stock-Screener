"use client";

import { useMemo, useState } from "react";
import ClosedTradeSummaryCards from "./ClosedTradeSummaryCards";
import { ClosedTradeSummary, formatPct } from "@/lib/analytics/closedTradeSummary";

type PositionRow = {
  id: string;
  portfolio_id?: string | null;
  symbol: string;
  status: "OPEN" | "CLOSED" | string;
  strategy_version?: string | null;
  max_hold_days?: number | null;
  tp_model?: string | null;
  tp_plan?: string | null;
  tp1_pct?: number | null;
  tp2_pct?: number | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp1_size_pct?: number | null;
  tp2_size_pct?: number | null;
  entry_date?: string | null;

  entry_price: number | null;
  entry_fee?: number | null;
  stop_price?: number | null;

  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;

  exit_price: number | null;
  exit_fee?: number | null;
  closed_at: string | null;
  exit_reason?: "TP1" | "TP2" | "STOP" | "MANUAL" | "TIME" | string | null;
  exit_date?: string | null;

  created_at?: string | null;
};

type GroupedOpenRow = {
  portfolio_id: string | null;
  symbol: string;
  strategy_version: string;
  maxHoldDays: number | null;
  qty: number;
  avgEntry: number | null;
  stop: number | null; // placeholder; we’ll keep blank for now
  openedAt: string | null; // earliest created_at across lots
  last: number | null;
  unrealUsd: number | null;
  feesUsd: number;
  netUsd: number | null;
  unrealPct: number | null;
  lotIds: string[];
  tpPlanSummary: string | null;
};

type TpPlan = "none" | "tp1_only" | "tp1_tp2";

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function formatMoney(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `$${x.toFixed(2)}`;
}

function formatMoneySigned(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}$${x.toFixed(2)}`;
}

function formatNum(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return x.toFixed(2);
}

function formatInt(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `${Math.round(x)}`;
}

function formatDate(x: string | null | undefined) {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function resolveQty(p: PositionRow): number {
  const v =
    (typeof p.shares === "number" ? p.shares : null) ??
    (typeof p.quantity === "number" ? p.quantity : null) ??
    (typeof p.position_size === "number" ? p.position_size : null) ??
    0;
  return Number.isFinite(v) ? v : 0;
}

function strategyLabel(version: string | null | undefined) {
  return version === "v1_trend_hold" ? "Trend" : "Momentum";
}

function strategyChipClass(version: string | null | undefined) {
  return version === "v1_trend_hold"
    ? "border-sky-200 bg-sky-50 text-sky-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function fmtPctShort(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v * 100) / 100;
  return Number.isInteger(n) ? `${n.toFixed(0)}%` : `${n.toFixed(2)}%`;
}

function tpPlanSummaryFor(p: {
  tp_plan?: string | null;
  tp1_pct?: number | null;
  tp2_pct?: number | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp1_size_pct?: number | null;
  tp2_size_pct?: number | null;
  strategy_version?: string | null;
  entry_price?: number | null;
}) {
  const plan = String(p.tp_plan ?? "").toLowerCase();
  const isTrend = (p.strategy_version ?? "") === "v1_trend_hold";
  const defaultTp1 = isTrend ? 10 : 5;
  const defaultTp2 = isTrend ? 20 : 10;
  const tp1 = typeof p.tp1_pct === "number" ? p.tp1_pct : defaultTp1;
  const tp2 = typeof p.tp2_pct === "number" ? p.tp2_pct : defaultTp2;
  const tp1Label = fmtPctShort(tp1) ?? `${tp1}%`;
  const tp2Label = fmtPctShort(tp2) ?? `${tp2}%`;
  const tp1Size = typeof p.tp1_size_pct === "number" ? p.tp1_size_pct : plan === "tp1_only" ? 100 : 50;
  const tp2Size = typeof p.tp2_size_pct === "number" ? p.tp2_size_pct : 50;

  const tp1PriceLabel = formatMoney(typeof p.tp1_price === "number" ? p.tp1_price : p.entry_price != null ? p.entry_price * (1 + tp1 / 100) : null);
  const tp2PriceLabel = formatMoney(typeof p.tp2_price === "number" ? p.tp2_price : p.entry_price != null ? p.entry_price * (1 + tp2 / 100) : null);
  if (plan === "" || plan === "none") return "No TP";
  if (plan === "tp1_only") return `TP1: ${tp1PriceLabel} (${tp1Label}, ${Math.round(tp1Size)}%)`;
  if (plan === "tp1_tp2") return `TP1: ${tp1PriceLabel} (${tp1Label}, ${Math.round(tp1Size)}%) + TP2: ${tp2PriceLabel} (${tp2Label}, ${Math.round(tp2Size)}%)`;
  return "No TP";
}

function defaultTpPercentsForStrategy(version: string | null | undefined) {
  return version === "v1_trend_hold" ? { tp1Pct: 10, tp2Pct: 20 } : { tp1Pct: 5, tp2Pct: 10 };
}

function dayDiffFromDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const utcStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const utcEntry = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(0, Math.floor((utcStart - utcEntry) / 86_400_000));
}

function buildTimeStopView(heldFrom: string | null | undefined, maxHoldDays: number | null | undefined) {
  if (!heldFrom || typeof maxHoldDays !== "number" || !Number.isFinite(maxHoldDays) || maxHoldDays <= 0) {
    return {
      date: null as string | null,
      daysHeld: null as number | null,
      daysLeft: null as number | null,
      isDue: false,
      warnSoon: false,
      label: "—",
    };
  }

  const start = new Date(heldFrom);
  if (Number.isNaN(start.getTime())) {
    return {
      date: null as string | null,
      daysHeld: null as number | null,
      daysLeft: null as number | null,
      isDue: false,
      warnSoon: false,
      label: "—",
    };
  }

  const daysHeld = dayDiffFromDate(heldFrom);
  const daysLeft = daysHeld !== null ? maxHoldDays - daysHeld : null;
  const d = new Date(start);
  d.setDate(d.getDate() + maxHoldDays);
  const date = d.toISOString().slice(0, 10);
  const isDue = daysLeft !== null ? daysLeft <= 0 : false;
  const warnSoon = daysLeft !== null ? daysLeft > 0 && daysLeft <= 2 : false;
  const label = isDue ? `TIME STOP — exit today` : `Exit @ market on ${date}`;

  return { date, daysHeld, daysLeft, isDue, warnSoon, label };
}

function computeClosedPnL(p: PositionRow) {
  const entry = p.entry_price ?? null;
  const exit = p.exit_price ?? null;
  if (typeof entry !== "number" || typeof exit !== "number" || entry <= 0) return null;

  const qty = resolveQty(p);
  const grossUsd = (exit - entry) * qty;
  const feesUsd = (typeof p.entry_fee === "number" ? p.entry_fee : 0) + (typeof p.exit_fee === "number" ? p.exit_fee : 0);
  const netUsd = grossUsd - feesUsd;
  const positionCost = entry * qty;
  const netPct = positionCost > 0 ? netUsd / positionCost : null;
  return { grossUsd, feesUsd, netUsd, netPct };
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="text-base font-semibold text-slate-900">{title}</div>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">
        {message}
      </div>
    </div>
  );
}

export default function PositionsClient({
  openPositions,
  closedPositions,
  closedSummary,
  latestPriceBySymbol,
  defaultFeePerOrder = null,
}: {
  openPositions: PositionRow[];
  closedPositions: PositionRow[];
  closedSummary: ClosedTradeSummary;
  latestPriceBySymbol: Record<string, number | null>;
  defaultFeePerOrder?: number | null;
}) {
  const [tab, setTab] = useState<"OPEN" | "CLOSED">("OPEN");
  const [strategyFilter, setStrategyFilter] = useState<"ALL" | "MOMENTUM" | "TREND">("ALL");

  // Open table mode: grouped vs lots
  const [openMode, setOpenMode] = useState<"GROUPED" | "LOTS">("GROUPED");

  // toast
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  // Close modal state (still closes a single lot for now)
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [activePosition, setActivePosition] = useState<PositionRow | null>(null);
  const [exitPriceInput, setExitPriceInput] = useState("");
  const [exitFeeInput, setExitFeeInput] = useState("");
  const [exitReasonInput, setExitReasonInput] = useState<"TP1" | "TP2" | "STOP" | "MANUAL" | "TIME">("MANUAL");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closingGroupKey, setClosingGroupKey] = useState<string | null>(null);

  // Manual add modal state
  const [manualOpen, setManualOpen] = useState(false);
  const [mSymbol, setMSymbol] = useState("");
  const [mEntry, setMEntry] = useState("");
  const [mStop, setMStop] = useState("");
  const [mQty, setMQty] = useState("");
  const [mTpPlan, setMTpPlan] = useState<TpPlan>("none");
  const [mTp1Pct, setMTp1Pct] = useState("");
  const [mTp2Pct, setMTp2Pct] = useState("");
  const [mTp1Price, setMTp1Price] = useState("");
  const [mTp2Price, setMTp2Price] = useState("");
  const [mTp1SizePct, setMTp1SizePct] = useState("");
  const [mTp2SizePct, setMTp2SizePct] = useState("");
  const [mEntryFee, setMEntryFee] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  const [editTpOpen, setEditTpOpen] = useState(false);
  const [editTpPosition, setEditTpPosition] = useState<PositionRow | null>(null);
  const [editTpPlan, setEditTpPlan] = useState<TpPlan>("none");
  const [editTp1Pct, setEditTp1Pct] = useState("");
  const [editTp2Pct, setEditTp2Pct] = useState("");
  const [editTp1Price, setEditTp1Price] = useState("");
  const [editTp2Price, setEditTp2Price] = useState("");
  const [editTp1SizePct, setEditTp1SizePct] = useState("");
  const [editTp2SizePct, setEditTp2SizePct] = useState("");
  const [editTpBusy, setEditTpBusy] = useState(false);
  const [editTpError, setEditTpError] = useState<string | null>(null);
  const [editFeesOpen, setEditFeesOpen] = useState(false);
  const [editFeesPosition, setEditFeesPosition] = useState<PositionRow | null>(null);
  const [editEntryFeeInput, setEditEntryFeeInput] = useState("");
  const [editExitFeeInput, setEditExitFeeInput] = useState("");
  const [editFeesBusy, setEditFeesBusy] = useState(false);
  const [editFeesError, setEditFeesError] = useState<string | null>(null);

  const openFiltered = useMemo(() => {
    if (strategyFilter === "ALL") return openPositions;
    if (strategyFilter === "TREND") return openPositions.filter((p) => p.strategy_version === "v1_trend_hold");
    return openPositions.filter((p) => (p.strategy_version ?? "v2_core_momentum") !== "v1_trend_hold");
  }, [openPositions, strategyFilter]);

  const closedFiltered = useMemo(() => {
    if (strategyFilter === "ALL") return closedPositions;
    if (strategyFilter === "TREND") return closedPositions.filter((p) => p.strategy_version === "v1_trend_hold");
    return closedPositions.filter((p) => (p.strategy_version ?? "v2_core_momentum") !== "v1_trend_hold");
  }, [closedPositions, strategyFilter]);

  const closedWithPnL = useMemo(() => {
    return closedFiltered.map((p) => ({ ...p, pnl: computeClosedPnL(p) }));
  }, [closedFiltered]);

  const hasClosedTrades = closedWithPnL.length > 0;

  function openCloseModal(p: PositionRow) {
    setActivePosition(p);
    setExitPriceInput("");
    setExitFeeInput(
      typeof defaultFeePerOrder === "number" && Number.isFinite(defaultFeePerOrder)
        ? defaultFeePerOrder.toFixed(2)
        : ""
    );
    setExitReasonInput("MANUAL");
    setCloseError(null);
    setCloseModalOpen(true);
  }

  function closeCloseModal() {
    if (closing) return;
    setCloseModalOpen(false);
    setActivePosition(null);
    setExitPriceInput("");
    setExitFeeInput("");
    setExitReasonInput("MANUAL");
    setCloseError(null);
  }

  async function submitClose() {
    if (!activePosition) return;

    const exitPrice = Number(exitPriceInput);
    const exitFee = Number(exitFeeInput);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      setCloseError("Please enter a valid positive exit price.");
      return;
    }
    if (exitFeeInput.trim() && (!Number.isFinite(exitFee) || exitFee < 0)) {
      setCloseError("Exit fee must be blank or >= 0.");
      return;
    }

    try {
      setClosing(true);
      setCloseError(null);

      const res = await fetch("/api/positions/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          position_id: activePosition.id,
          exit_price: exitPrice,
          exit_fee: exitFeeInput.trim() ? exitFee : null,
          exit_reason: exitReasonInput,
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Close failed.");
      }

      closeCloseModal();
      showToast("Position closed ✅");
      setTimeout(() => window.location.reload(), 650);
    } catch (e: any) {
      setCloseError(e?.message ?? "Close failed.");
    } finally {
      setClosing(false);
    }
  }

  async function submitCloseGrouped(row: GroupedOpenRow) {
    const portfolioId = String(row.portfolio_id ?? "").trim();
    if (!portfolioId) {
      showToast("Missing portfolio id for grouped position.");
      return;
    }
    const lotsCount = row.lotIds.length;
    const ok = window.confirm(
      `Close all lots for ${row.symbol} (${lotsCount} lot${lotsCount === 1 ? "" : "s"}, total qty ${Math.round(
        row.qty
      )})?`
    );
    if (!ok) return;

    const groupKey = `${row.portfolio_id ?? ""}:${row.symbol}`;
    try {
      setClosingGroupKey(groupKey);
      const res = await fetch("/api/portfolio/close-symbol", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          symbol: row.symbol,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Close symbol failed.");
      }
      showToast(`Closed ${payload?.closed_count ?? lotsCount} lot(s) for ${row.symbol} ✅`);
      setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      showToast(e?.message ?? "Close symbol failed.");
    } finally {
      setClosingGroupKey(null);
    }
  }

  function openManual() {
    setMSymbol("");
    setMEntry("");
    setMStop("");
    setMQty("");
    setMTpPlan("none");
    setMTp1Pct("");
    setMTp2Pct("");
    setMTp1Price("");
    setMTp2Price("");
    setMTp1SizePct("");
    setMTp2SizePct("");
    setMEntryFee(
      typeof defaultFeePerOrder === "number" && Number.isFinite(defaultFeePerOrder)
        ? defaultFeePerOrder.toFixed(2)
        : ""
    );
    setManualError(null);
    setManualOpen(true);
  }

  function closeManual() {
    if (manualBusy) return;
    setManualOpen(false);
    setManualError(null);
  }

  function applyTpPlanDefaults(
    plan: TpPlan,
    strategyVersion: string | null | undefined,
    entryPrice: number | null | undefined,
    setTp1Pct: (v: string) => void,
    setTp2Pct: (v: string) => void,
    setTp1Price: (v: string) => void,
    setTp2Price: (v: string) => void,
    setTp1SizePct: (v: string) => void,
    setTp2SizePct: (v: string) => void
  ) {
    const defaults = defaultTpPercentsForStrategy(strategyVersion);
    const entry = typeof entryPrice === "number" && Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : null;
    if (plan === "none") {
      setTp1Pct("");
      setTp2Pct("");
      setTp1Price("");
      setTp2Price("");
      setTp1SizePct("");
      setTp2SizePct("");
      return;
    }
    if (plan === "tp1_only") {
      setTp1Pct(String(defaults.tp1Pct));
      setTp2Pct("");
      setTp1Price(entry !== null ? (entry * (1 + defaults.tp1Pct / 100)).toFixed(2) : "");
      setTp2Price("");
      setTp1SizePct("100");
      setTp2SizePct("0");
      return;
    }
    setTp1Pct(String(defaults.tp1Pct));
    setTp2Pct(String(defaults.tp2Pct));
    setTp1Price(entry !== null ? (entry * (1 + defaults.tp1Pct / 100)).toFixed(2) : "");
    setTp2Price(entry !== null ? (entry * (1 + defaults.tp2Pct / 100)).toFixed(2) : "");
    setTp1SizePct("50");
    setTp2SizePct("50");
  }

  async function submitManual() {
    const symbol = mSymbol.trim().toUpperCase();
    const entry = Number(mEntry);
    const stop = Number(mStop);
    const qty = Number(mQty);
    const tp1Pct = Number(mTp1Pct);
    const tp2Pct = Number(mTp2Pct);
    const tp1Price = Number(mTp1Price);
    const tp2Price = Number(mTp2Price);
    const tp1SizePct = Math.round(Number(mTp1SizePct));
    const tp2SizePct = Math.round(Number(mTp2SizePct));
    const entryFee = Number(mEntryFee);

    if (!symbol) return setManualError("Symbol is required (e.g. AAPL).");
    if (!Number.isFinite(entry) || entry <= 0) return setManualError("Entry price must be a positive number.");
    if (mStop.trim() && (!Number.isFinite(stop) || stop <= 0))
      return setManualError("Stop must be blank or a positive number.");
    if (mQty.trim() && (!Number.isFinite(qty) || qty <= 0))
      return setManualError("Quantity must be blank or a positive number.");
    if (mTpPlan !== "none" && (!Number.isFinite(tp1Pct) || tp1Pct <= 0) && (!Number.isFinite(tp1Price) || tp1Price <= 0))
      return setManualError("TP1 % or TP1 price must be provided.");
    if (mTpPlan === "tp1_tp2" && (!Number.isFinite(tp2Pct) || tp2Pct <= 0) && (!Number.isFinite(tp2Price) || tp2Price <= 0))
      return setManualError("TP2 % or TP2 price must be provided.");
    if (mTpPlan !== "none" && (!Number.isFinite(tp1SizePct) || tp1SizePct < 0 || tp1SizePct > 100))
      return setManualError("TP1 size % must be between 0 and 100.");
    if (mTpPlan === "tp1_tp2" && (!Number.isFinite(tp2SizePct) || tp2SizePct < 0 || tp2SizePct > 100))
      return setManualError("TP2 size % must be between 0 and 100.");
    if (mEntryFee.trim() && (!Number.isFinite(entryFee) || entryFee < 0)) {
      return setManualError("Entry fee must be blank or >= 0.");
    }

    try {
      setManualBusy(true);
      setManualError(null);

      const res = await fetch("/api/positions/manual-add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          entry_price: entry,
          stop_price: mStop.trim() ? stop : null,
          quantity: mQty.trim() ? qty : null,
          tp_plan: mTpPlan,
          tp1_pct: mTpPlan === "none" ? null : tp1Pct,
          tp2_pct: mTpPlan === "tp1_tp2" ? tp2Pct : null,
          tp1_price: mTpPlan === "none" ? null : (Number.isFinite(tp1Price) ? tp1Price : null),
          tp2_price: mTpPlan === "tp1_tp2" ? (Number.isFinite(tp2Price) ? tp2Price : null) : null,
          tp1_size_pct: mTpPlan === "none" ? null : tp1SizePct,
          tp2_size_pct: mTpPlan === "tp1_tp2" ? tp2SizePct : 0,
          entry_fee: mEntryFee.trim() ? entryFee : null,
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Manual add failed.");
      }

      closeManual();
      showToast("Holding added ✅");
      setTimeout(() => window.location.reload(), 650);
    } catch (e: any) {
      setManualError(e?.message ?? "Manual add failed.");
    } finally {
      setManualBusy(false);
    }
  }

  function openEditTpModal(p: PositionRow) {
    setEditTpPosition(p);
    const currentPlan = String(p.tp_plan ?? "").toLowerCase();
    const plan: TpPlan =
      currentPlan === "tp1_only" || currentPlan === "tp1_tp2" || currentPlan === "none"
        ? (currentPlan as TpPlan)
        : "none";
    setEditTpPlan(plan);

    const defaults = defaultTpPercentsForStrategy(p.strategy_version);
    setEditTp1Pct(String(p.tp1_pct ?? defaults.tp1Pct));
    setEditTp2Pct(String(p.tp2_pct ?? defaults.tp2Pct));
    const entry = typeof p.entry_price === "number" && Number.isFinite(p.entry_price) && p.entry_price > 0 ? p.entry_price : null;
    setEditTp1Price(
      p.tp1_price != null
        ? String(p.tp1_price)
        : entry !== null
          ? (entry * (1 + Number(p.tp1_pct ?? defaults.tp1Pct) / 100)).toFixed(2)
          : ""
    );
    setEditTp2Price(
      p.tp2_price != null
        ? String(p.tp2_price)
        : entry !== null
          ? (entry * (1 + Number(p.tp2_pct ?? defaults.tp2Pct) / 100)).toFixed(2)
          : ""
    );
    setEditTp1SizePct(String(p.tp1_size_pct ?? (plan === "tp1_only" ? 100 : 50)));
    setEditTp2SizePct(String(p.tp2_size_pct ?? (plan === "tp1_tp2" ? 50 : 0)));
    if (plan === "none") {
      setEditTp1Pct("");
      setEditTp2Pct("");
      setEditTp1Price("");
      setEditTp2Price("");
      setEditTp1SizePct("");
      setEditTp2SizePct("");
    }
    setEditTpError(null);
    setEditTpOpen(true);
  }

  function closeEditTpModal() {
    if (editTpBusy) return;
    setEditTpOpen(false);
    setEditTpPosition(null);
    setEditTpError(null);
  }

  async function submitEditTp() {
    if (!editTpPosition) return;
    const tp1Pct = Number(editTp1Pct);
    const tp2Pct = Number(editTp2Pct);
    const tp1Price = Number(editTp1Price);
    const tp2Price = Number(editTp2Price);
    const tp1SizePct = Math.round(Number(editTp1SizePct));
    const tp2SizePct = Math.round(Number(editTp2SizePct));

    if (
      editTpPlan !== "none" &&
      (!Number.isFinite(tp1Pct) || tp1Pct <= 0) &&
      (!Number.isFinite(tp1Price) || tp1Price <= 0)
    ) {
      setEditTpError("TP1 % or TP1 price must be provided.");
      return;
    }
    if (
      editTpPlan === "tp1_tp2" &&
      (!Number.isFinite(tp2Pct) || tp2Pct <= 0) &&
      (!Number.isFinite(tp2Price) || tp2Price <= 0)
    ) {
      setEditTpError("TP2 % or TP2 price must be provided.");
      return;
    }
    if (editTpPlan !== "none" && (!Number.isFinite(tp1SizePct) || tp1SizePct < 0 || tp1SizePct > 100)) {
      setEditTpError("TP1 size % must be between 0 and 100.");
      return;
    }
    if (editTpPlan === "tp1_tp2" && (!Number.isFinite(tp2SizePct) || tp2SizePct < 0 || tp2SizePct > 100)) {
      setEditTpError("TP2 size % must be between 0 and 100.");
      return;
    }

    try {
      setEditTpBusy(true);
      setEditTpError(null);

      const res = await fetch("/api/positions/update-tp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          position_id: editTpPosition.id,
          tp_plan: editTpPlan,
          tp1_pct: editTpPlan === "none" ? null : tp1Pct,
          tp2_pct: editTpPlan === "tp1_tp2" ? tp2Pct : null,
          tp1_price: editTpPlan === "none" ? null : (Number.isFinite(tp1Price) ? tp1Price : null),
          tp2_price: editTpPlan === "tp1_tp2" ? (Number.isFinite(tp2Price) ? tp2Price : null) : null,
          tp1_size_pct: editTpPlan === "none" ? null : tp1SizePct,
          tp2_size_pct: editTpPlan === "tp1_tp2" ? tp2SizePct : 0,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Update TP plan failed.");
      }

      closeEditTpModal();
      showToast("TP plan updated ✅");
      setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      setEditTpError(e?.message ?? "Update TP plan failed.");
    } finally {
      setEditTpBusy(false);
    }
  }

  function openEditFeesModal(p: PositionRow) {
    setEditFeesPosition(p);
    setEditEntryFeeInput(
      typeof p.entry_fee === "number" && Number.isFinite(p.entry_fee) ? String(p.entry_fee) : ""
    );
    setEditExitFeeInput(
      typeof p.exit_fee === "number" && Number.isFinite(p.exit_fee) ? String(p.exit_fee) : ""
    );
    setEditFeesError(null);
    setEditFeesOpen(true);
  }

  function closeEditFeesModal() {
    if (editFeesBusy) return;
    setEditFeesOpen(false);
    setEditFeesPosition(null);
    setEditEntryFeeInput("");
    setEditExitFeeInput("");
    setEditFeesError(null);
  }

  async function submitEditFees() {
    if (!editFeesPosition) return;
    const entryFee = Number(editEntryFeeInput);
    const exitFee = Number(editExitFeeInput);
    if (editEntryFeeInput.trim() && (!Number.isFinite(entryFee) || entryFee < 0)) {
      setEditFeesError("Entry fee must be blank or >= 0.");
      return;
    }
    if (editExitFeeInput.trim() && (!Number.isFinite(exitFee) || exitFee < 0)) {
      setEditFeesError("Exit fee must be blank or >= 0.");
      return;
    }

    try {
      setEditFeesBusy(true);
      setEditFeesError(null);
      const res = await fetch("/api/positions/update-fees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          position_id: editFeesPosition.id,
          entry_fee: editEntryFeeInput.trim() ? entryFee : null,
          exit_fee: editExitFeeInput.trim() ? exitFee : null,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Update fees failed.");
      }

      closeEditFeesModal();
      showToast("Fees updated ✅");
      setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      setEditFeesError(e?.message ?? "Update fees failed.");
    } finally {
      setEditFeesBusy(false);
    }
  }

  // Build grouped open rows
  const groupedOpen: GroupedOpenRow[] = useMemo(() => {
    const map = new Map<string, { lots: PositionRow[] }>();

    for (const p of openFiltered) {
      const sym = (p.symbol ?? "").toUpperCase();
      if (!sym) continue;
      const strat = p.strategy_version ?? "v2_core_momentum";
      const key = `${strat}::${sym}`;
      const cur = map.get(key) ?? { lots: [] };
      cur.lots.push(p);
      map.set(key, cur);
    }

    const rows: GroupedOpenRow[] = [];

    for (const [_key, { lots }] of map.entries()) {
      const symbol = (lots[0]?.symbol ?? "").toUpperCase();
      let totalQty = 0;
      let costSum = 0;
      let feesSum = 0;

      let earliest: string | null = null;

      for (const l of lots) {
        const q = resolveQty(l);
        const entry = l.entry_price ?? null;
        if (typeof entry === "number" && entry > 0 && q > 0) {
          totalQty += q;
          costSum += entry * q;
        }
        feesSum +=
          (typeof l.entry_fee === "number" && Number.isFinite(l.entry_fee) ? l.entry_fee : 0) +
          (typeof l.exit_fee === "number" && Number.isFinite(l.exit_fee) ? l.exit_fee : 0);

        const dt = l.created_at ?? null;
        if (dt && (!earliest || new Date(dt).getTime() < new Date(earliest).getTime())) {
          earliest = dt;
        }
      }

      const avgEntry = totalQty > 0 ? costSum / totalQty : null;
      const last = latestPriceBySymbol?.[symbol] ?? null;

      let unrealUsd: number | null = null;
      let netUsd: number | null = null;
      let unrealPct: number | null = null;

      if (typeof avgEntry === "number" && avgEntry > 0 && typeof last === "number" && Number.isFinite(last)) {
        unrealUsd = (last - avgEntry) * totalQty;
        netUsd = unrealUsd - feesSum;
        unrealPct = (last - avgEntry) / avgEntry;
      }

      const defaultMaxHold = (lots[0]?.strategy_version ?? "v2_core_momentum") === "v1_trend_hold" ? 45 : 7;
      const planSet = new Set(lots.map((l) => tpPlanSummaryFor(l)));
      const tpPlanSummary = planSet.size === 1 ? (Array.from(planSet)[0] ?? null) : "Mixed";

      rows.push({
        portfolio_id: lots[0]?.portfolio_id ?? null,
        symbol,
        strategy_version: lots[0]?.strategy_version ?? "v2_core_momentum",
        maxHoldDays: lots[0]?.max_hold_days ?? defaultMaxHold,
        qty: totalQty,
        avgEntry,
        stop: null,
        openedAt: earliest,
        last: typeof last === "number" ? last : null,
        unrealUsd,
        feesUsd: feesSum,
        netUsd,
        unrealPct,
        lotIds: lots.map((x) => x.id),
        tpPlanSummary,
      });
    }

    // Sort: biggest unrealized $ magnitude first
    rows.sort((a, b) => {
      const av = a.unrealUsd ?? 0;
      const bv = b.unrealUsd ?? 0;
      return Math.abs(bv) - Math.abs(av);
    });

    return rows;
  }, [openFiltered, latestPriceBySymbol]);

  const openById = useMemo(() => {
    const m = new Map<string, PositionRow>();
    for (const p of openFiltered) m.set(p.id, p);
    return m;
  }, [openFiltered]);

  return (
    <div className="space-y-4">
      {toast ? <Toast message={toast} /> : null}

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <button
          className={clsx(
            "rounded-xl border px-3 py-1.5 text-sm font-medium",
            tab === "OPEN"
              ? "border-slate-300 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
          )}
          onClick={() => setTab("OPEN")}
        >
          Open
        </button>
        <button
          className={clsx(
            "rounded-xl border px-3 py-1.5 text-sm font-medium",
            tab === "CLOSED"
              ? "border-slate-300 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
          )}
          onClick={() => setTab("CLOSED")}
        >
          Closed
        </button>

        <div className="ml-2 flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
          <button
            className={clsx(
              "rounded-lg px-2 py-1 text-xs font-medium",
              strategyFilter === "ALL" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
            )}
            onClick={() => setStrategyFilter("ALL")}
          >
            All
          </button>
          <button
            className={clsx(
              "rounded-lg px-2 py-1 text-xs font-medium",
              strategyFilter === "MOMENTUM" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
            )}
            onClick={() => setStrategyFilter("MOMENTUM")}
          >
            Momentum
          </button>
          <button
            className={clsx(
              "rounded-lg px-2 py-1 text-xs font-medium",
              strategyFilter === "TREND" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
            )}
            onClick={() => setStrategyFilter("TREND")}
          >
            Trend
          </button>
        </div>
      </div>

      {/* OPEN */}
      {tab === "OPEN" ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 p-3 border-b border-slate-200 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">Open positions</div>

              <div className="ml-2 flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                <button
                  className={clsx(
                    "rounded-lg px-2 py-1 text-xs font-medium",
                    openMode === "GROUPED" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                  )}
                  onClick={() => setOpenMode("GROUPED")}
                >
                  Grouped
                </button>
                <button
                  className={clsx(
                    "rounded-lg px-2 py-1 text-xs font-medium",
                    openMode === "LOTS" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                  )}
                  onClick={() => setOpenMode("LOTS")}
                >
                  Lots
                </button>
              </div>
            </div>

            <button
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              onClick={openManual}
            >
              + Add Existing Holding
            </button>
          </div>

          <div className="overflow-x-auto">
            {openMode === "GROUPED" ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="p-3">Symbol</th>
                    <th className="p-3">Strategy</th>
                    <th className="p-3">TP Plan</th>
                    <th className="p-3">Avg cost</th>
                    <th className="p-3">Last</th>
                    <th className="p-3">Qty</th>
                    <th className="p-3">Unrealized $</th>
                    <th className="p-3">Fees</th>
                    <th className="p-3">Net $</th>
                    <th className="p-3">Unrealized %</th>
                    <th className="p-3">Time-stop exit</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedOpen.length === 0 ? (
                    <tr>
                      <td className="p-3 text-slate-500" colSpan={12}>
                        No open positions.
                      </td>
                    </tr>
                  ) : (
                    groupedOpen.map((g) => {
                      const gross = g.unrealUsd ?? null;
                      const grossClass =
                        typeof gross === "number"
                          ? gross > 0
                            ? "text-emerald-600"
                            : gross < 0
                              ? "text-rose-600"
                              : "text-slate-600"
                          : "text-slate-500";
                      const net = g.netUsd ?? null;
                      const netClass =
                        typeof net === "number"
                          ? net > 0
                            ? "text-emerald-600"
                            : net < 0
                              ? "text-rose-600"
                              : "text-slate-600"
                          : "text-slate-500";

                      const timeStop = buildTimeStopView(g.openedAt, g.maxHoldDays);

                      return (
                        <tr
                          key={`${g.strategy_version}-${g.symbol}`}
                          className={clsx(
                            "border-b border-slate-100",
                            timeStop.isDue && "bg-amber-50/50"
                          )}
                        >
                          <td className="p-3 font-semibold text-slate-900">{g.symbol}</td>
                          <td className="p-3">
                            <span className={clsx("rounded-full border px-2 py-1 text-xs font-semibold", strategyChipClass(g.strategy_version))}>
                              {strategyLabel(g.strategy_version)}
                            </span>
                          </td>
                          <td className="p-3 text-slate-700">{g.tpPlanSummary ?? "—"}</td>
                          <td className="p-3 text-slate-800">{formatMoney(g.avgEntry)}</td>
                          <td className="p-3 text-slate-800">{formatMoney(g.last)}</td>
                          <td className="p-3 text-slate-800">{formatInt(g.qty)}</td>
                          <td className={clsx("p-3 font-semibold", grossClass)}>{formatMoneySigned(g.unrealUsd)}</td>
                          <td className="p-3 text-slate-700">{formatMoney(g.feesUsd)}</td>
                          <td className={clsx("p-3 font-semibold", netClass)}>{formatMoneySigned(g.netUsd)}</td>
                          <td className={clsx("p-3 font-semibold", grossClass)}>
                            {typeof g.unrealPct === "number" ? formatPct(g.unrealPct) : "—"}
                          </td>
                          <td className="p-3 text-slate-800">
                            <div
                              className={clsx(
                                "font-medium",
                                timeStop.isDue ? "text-rose-700" : "text-slate-900"
                              )}
                            >
                              {timeStop.label}
                            </div>
                            <div className="text-xs text-slate-500">
                              {timeStop.daysHeld !== null ? `${timeStop.daysHeld}d held` : "—"}{" "}
                              {timeStop.daysLeft !== null ? `• ${Math.max(timeStop.daysLeft, 0)}d left` : ""}
                            </div>
                            {timeStop.warnSoon ? (
                              <span className="mt-1 inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                TIME STOP SOON
                              </span>
                            ) : null}
                          </td>
                          <td className="p-3 text-right text-xs text-slate-500">
                            <div className="flex justify-end gap-2">
                              <button
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                                onClick={() => {
                                  const lot = g.lotIds[0] ? openById.get(g.lotIds[0]) : null;
                                  if (lot) openEditFeesModal(lot);
                                }}
                                disabled={g.lotIds.length !== 1}
                                title={g.lotIds.length !== 1 ? "Switch to Lots mode to edit per-lot fees" : "Edit fees"}
                              >
                                Edit fees
                              </button>
                              <button
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                                onClick={() => {
                                  const lot = g.lotIds[0] ? openById.get(g.lotIds[0]) : null;
                                  if (lot) openEditTpModal(lot);
                                }}
                                disabled={g.lotIds.length !== 1}
                                title={g.lotIds.length !== 1 ? "Switch to Lots mode to edit per-lot TP plan" : "Edit TP plan"}
                              >
                                Edit TP plan
                              </button>
                              <button
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                                onClick={() => submitCloseGrouped(g)}
                                disabled={closingGroupKey === `${g.portfolio_id ?? ""}:${g.symbol}`}
                                title="Close all open lots for this symbol"
                              >
                                {closingGroupKey === `${g.portfolio_id ?? ""}:${g.symbol}` ? "Closing..." : "Close"}
                              </button>
                              <span className="self-center">
                                {g.lotIds.length} lot{g.lotIds.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="p-3">Symbol</th>
                    <th className="p-3">Strategy</th>
                    <th className="p-3">TP Plan</th>
                    <th className="p-3">Entry</th>
                    <th className="p-3">Last</th>
                    <th className="p-3">Qty</th>
                    <th className="p-3">Unrealized $</th>
                    <th className="p-3">Fees</th>
                    <th className="p-3">Net $</th>
                    <th className="p-3">Unrealized %</th>
                    <th className="p-3">Time-stop exit</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openFiltered.length === 0 ? (
                    <tr>
                      <td className="p-3 text-slate-500" colSpan={12}>
                        No open positions.
                      </td>
                    </tr>
                  ) : (
                    openFiltered.map((p) => {
                      const qty = resolveQty(p);
                      const last = latestPriceBySymbol?.[(p.symbol ?? "").toUpperCase()] ?? null;
                      const strategyVer = p.strategy_version ?? "v2_core_momentum";
                      const maxHold = p.max_hold_days ?? (strategyVer === "v1_trend_hold" ? 45 : 7);
                      const heldFrom = p.entry_date ?? p.created_at ?? null;
                      const timeStop = buildTimeStopView(heldFrom, maxHold);

                      let unrealUsd: number | null = null;
                      let netUsd: number | null = null;
                      let unrealPct: number | null = null;
                      const feesUsd =
                        (typeof p.entry_fee === "number" && Number.isFinite(p.entry_fee) ? p.entry_fee : 0) +
                        (typeof p.exit_fee === "number" && Number.isFinite(p.exit_fee) ? p.exit_fee : 0);

                      if (
                        typeof p.entry_price === "number" &&
                        p.entry_price > 0 &&
                        typeof last === "number" &&
                        Number.isFinite(last) &&
                        qty > 0
                      ) {
                        unrealUsd = (last - p.entry_price) * qty;
                        netUsd = unrealUsd - feesUsd;
                        unrealPct = (last - p.entry_price) / p.entry_price;
                      }

                      const grossClass =
                        typeof unrealUsd === "number"
                          ? unrealUsd > 0
                            ? "text-emerald-600"
                            : unrealUsd < 0
                              ? "text-rose-600"
                              : "text-slate-600"
                          : "text-slate-500";
                      const netClass =
                        typeof netUsd === "number"
                          ? netUsd > 0
                            ? "text-emerald-600"
                            : netUsd < 0
                              ? "text-rose-600"
                              : "text-slate-600"
                          : "text-slate-500";

                      return (
                        <tr
                          key={p.id}
                          className={clsx(
                            "border-b border-slate-100",
                            timeStop.isDue && "bg-amber-50/50"
                          )}
                        >
                          <td className="p-3 font-semibold text-slate-900">{p.symbol}</td>
                          <td className="p-3">
                            <span className={clsx("rounded-full border px-2 py-1 text-xs font-semibold", strategyChipClass(strategyVer))}>
                              {strategyLabel(strategyVer)}
                            </span>
                          </td>
                          <td className="p-3 text-slate-700">{tpPlanSummaryFor(p)}</td>
                          <td className="p-3 text-slate-800">{formatMoney(p.entry_price)}</td>
                          <td className="p-3 text-slate-800">{formatMoney(last)}</td>
                          <td className="p-3 text-slate-800">{qty || "—"}</td>
                          <td className={clsx("p-3 font-semibold", grossClass)}>{formatMoneySigned(unrealUsd)}</td>
                          <td className="p-3 text-slate-700">{formatMoney(feesUsd)}</td>
                          <td className={clsx("p-3 font-semibold", netClass)}>{formatMoneySigned(netUsd)}</td>
                          <td className={clsx("p-3 font-semibold", grossClass)}>
                            {typeof unrealPct === "number" ? formatPct(unrealPct) : "—"}
                          </td>
                          <td className="p-3 text-slate-800">
                            <div
                              className={clsx(
                                "font-medium",
                                timeStop.isDue ? "text-rose-700" : "text-slate-900"
                              )}
                            >
                              {timeStop.label}
                            </div>
                            <div className="text-xs text-slate-500">
                              {timeStop.daysHeld !== null ? `${timeStop.daysHeld}d held` : "—"}{" "}
                              {timeStop.daysLeft !== null ? `• ${Math.max(timeStop.daysLeft, 0)}d left` : ""}
                            </div>
                            {timeStop.warnSoon ? (
                              <span className="mt-1 inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                TIME STOP SOON
                              </span>
                            ) : null}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50"
                                onClick={() => openEditFeesModal(p)}
                              >
                                Edit fees
                              </button>
                              <button
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50"
                                onClick={() => openEditTpModal(p)}
                              >
                                Edit TP plan
                              </button>
                              <button
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50"
                                onClick={() => openCloseModal(p)}
                              >
                                Close
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Close modal */}
          <Modal
            open={closeModalOpen}
            title={activePosition ? `Close Position: ${activePosition.symbol}` : "Close Position"}
            onClose={closeCloseModal}
          >
            <div className="space-y-3">
              <div className="text-sm text-slate-600">
                Enter the exit price you sold at. This is saved for closed-trade history and P/L.
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-500">Exit price</label>
                <input
                  value={exitPriceInput}
                  onChange={(e) => setExitPriceInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 12.34"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  disabled={closing}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-500">Exit fee (USD, optional)</label>
                <input
                  value={exitFeeInput}
                  onChange={(e) => setExitFeeInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 1.00"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  disabled={closing}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-500">Exit reason</label>
                <select
                  value={exitReasonInput}
                  onChange={(e) =>
                    setExitReasonInput(
                      (e.target.value as "TP1" | "TP2" | "STOP" | "MANUAL" | "TIME") ?? "MANUAL"
                    )
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  disabled={closing}
                >
                  <option value="MANUAL">Manual</option>
                  <option value="TP1">TP1</option>
                  <option value="TP2">TP2</option>
                  <option value="STOP">Stop</option>
                  <option value="TIME">Time stop</option>
                </select>
                {closeError ? <div className="text-xs text-rose-600">{closeError}</div> : null}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  onClick={closeCloseModal}
                  disabled={closing}
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  onClick={submitClose}
                  disabled={closing}
                >
                  {closing ? "Closing..." : "Confirm Close"}
                </button>
              </div>
            </div>
          </Modal>

          <Modal
            open={editFeesOpen}
            title={editFeesPosition ? `Edit fees: ${editFeesPosition.symbol}` : "Edit fees"}
            onClose={closeEditFeesModal}
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="block text-xs text-slate-500">Entry fee (USD)</label>
                <input
                  value={editEntryFeeInput}
                  onChange={(e) => setEditEntryFeeInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 1.00"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  disabled={editFeesBusy}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-500">Exit fee (USD)</label>
                <input
                  value={editExitFeeInput}
                  onChange={(e) => setEditExitFeeInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 1.00"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  disabled={editFeesBusy}
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Total fees:{" "}
                <span className="font-semibold text-slate-900">
                  {formatMoney(
                    (Number.isFinite(Number(editEntryFeeInput)) ? Number(editEntryFeeInput) : 0) +
                      (Number.isFinite(Number(editExitFeeInput)) ? Number(editExitFeeInput) : 0)
                  )}
                </span>
              </div>

              {editFeesError ? <div className="text-sm text-rose-600">{editFeesError}</div> : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  onClick={closeEditFeesModal}
                  disabled={editFeesBusy}
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  onClick={submitEditFees}
                  disabled={editFeesBusy}
                >
                  {editFeesBusy ? "Saving..." : "Save fees"}
                </button>
              </div>
            </div>
          </Modal>

          {/* Manual add modal */}
          <Modal open={manualOpen} title="Add Existing Holding" onClose={closeManual}>
            <div className="space-y-3">
              <div className="text-sm text-slate-600">
                Add a holding you already own. This creates an OPEN position in your default portfolio.
              </div>

              <div className="grid gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Symbol</label>
                  <input
                    value={mSymbol}
                    onChange={(e) => setMSymbol(e.target.value)}
                    placeholder="e.g. AAPL"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    disabled={manualBusy}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Entry price</label>
                  <input
                    value={mEntry}
                    onChange={(e) => setMEntry(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 185.20"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    disabled={manualBusy}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Stop price (optional)</label>
                  <input
                    value={mStop}
                    onChange={(e) => setMStop(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 176.00"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    disabled={manualBusy}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Quantity (optional)</label>
                  <input
                    value={mQty}
                    onChange={(e) => setMQty(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 10"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    disabled={manualBusy}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Entry fee (USD, optional)</label>
                  <input
                    value={mEntryFee}
                    onChange={(e) => setMEntryFee(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 1.00"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    disabled={manualBusy}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Take profit plan</label>
                  <select
                    value={mTpPlan}
                    onChange={(e) => {
                      const next = e.target.value as TpPlan;
                      setMTpPlan(next);
                    applyTpPlanDefaults(
                      next,
                      "v2_core_momentum",
                      Number(mEntry),
                      setMTp1Pct,
                      setMTp2Pct,
                      setMTp1Price,
                      setMTp2Price,
                      setMTp1SizePct,
                      setMTp2SizePct
                    );
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    disabled={manualBusy}
                  >
                    <option value="none">None</option>
                    <option value="tp1_only">TP1 only</option>
                    <option value="tp1_tp2">TP1 + TP2</option>
                  </select>
                </div>

                {mTpPlan !== "none" ? (
                  <>
                    <div className="text-[11px] text-slate-500">
                      Based on entry: {Number.isFinite(Number(mEntry)) ? `$${Number(mEntry).toFixed(2)}` : "—"}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP1 %</label>
                      <input
                        value={mTp1Pct}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMTp1Pct(v);
                          const entry = Number(mEntry);
                          const pct = Number(v);
                          if (Number.isFinite(entry) && entry > 0 && Number.isFinite(pct) && pct > 0) {
                            setMTp1Price((entry * (1 + pct / 100)).toFixed(2));
                          }
                        }}
                        inputMode="decimal"
                        placeholder="e.g. 5"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={manualBusy}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP1 price</label>
                      <input
                        value={mTp1Price}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMTp1Price(v);
                          const entry = Number(mEntry);
                          const price = Number(v);
                          if (Number.isFinite(entry) && entry > 0 && Number.isFinite(price) && price > 0) {
                            setMTp1Pct((((price - entry) / entry) * 100).toFixed(2));
                          }
                        }}
                        inputMode="decimal"
                        placeholder="e.g. 105.00"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={manualBusy}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP1 size %</label>
                      <input
                        value={mTp1SizePct}
                        onChange={(e) => setMTp1SizePct(e.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 100"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={manualBusy}
                      />
                    </div>
                  </>
                ) : null}

                {mTpPlan === "tp1_tp2" ? (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP2 %</label>
                      <input
                        value={mTp2Pct}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMTp2Pct(v);
                          const entry = Number(mEntry);
                          const pct = Number(v);
                          if (Number.isFinite(entry) && entry > 0 && Number.isFinite(pct) && pct > 0) {
                            setMTp2Price((entry * (1 + pct / 100)).toFixed(2));
                          }
                        }}
                        inputMode="decimal"
                        placeholder="e.g. 10"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={manualBusy}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP2 price</label>
                      <input
                        value={mTp2Price}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMTp2Price(v);
                          const entry = Number(mEntry);
                          const price = Number(v);
                          if (Number.isFinite(entry) && entry > 0 && Number.isFinite(price) && price > 0) {
                            setMTp2Pct((((price - entry) / entry) * 100).toFixed(2));
                          }
                        }}
                        inputMode="decimal"
                        placeholder="e.g. 110.00"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={manualBusy}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP2 size %</label>
                      <input
                        value={mTp2SizePct}
                        onChange={(e) => setMTp2SizePct(e.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 50"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={manualBusy}
                      />
                    </div>
                  </>
                ) : null}
              </div>

              {manualError ? <div className="text-sm text-rose-600">{manualError}</div> : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  onClick={closeManual}
                  disabled={manualBusy}
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  onClick={submitManual}
                  disabled={manualBusy}
                >
                  {manualBusy ? "Saving..." : "Save Holding"}
                </button>
              </div>
            </div>
          </Modal>

          <Modal
            open={editTpOpen}
            title={editTpPosition ? `Edit TP plan: ${editTpPosition.symbol}` : "Edit TP plan"}
            onClose={closeEditTpModal}
          >
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Take profit plan</label>
                <select
                  value={editTpPlan}
                  onChange={(e) => {
                    const next = e.target.value as TpPlan;
                    setEditTpPlan(next);
                    applyTpPlanDefaults(
                      next,
                      editTpPosition?.strategy_version ?? "v2_core_momentum",
                      editTpPosition?.entry_price ?? null,
                      setEditTp1Pct,
                      setEditTp2Pct,
                      setEditTp1Price,
                      setEditTp2Price,
                      setEditTp1SizePct,
                      setEditTp2SizePct
                    );
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  disabled={editTpBusy}
                >
                  <option value="none">None</option>
                  <option value="tp1_only">TP1 only</option>
                  <option value="tp1_tp2">TP1 + TP2</option>
                </select>
              </div>

              {editTpPlan !== "none" ? (
                <>
                  <div className="text-[11px] text-slate-500">
                    Based on entry: {editTpPosition?.entry_price != null ? `$${Number(editTpPosition.entry_price).toFixed(2)}` : "—"}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP1 %</label>
                      <input
                        value={editTp1Pct}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditTp1Pct(v);
                          const entry = Number(editTpPosition?.entry_price);
                          const pct = Number(v);
                          if (Number.isFinite(entry) && entry > 0 && Number.isFinite(pct) && pct > 0) {
                            setEditTp1Price((entry * (1 + pct / 100)).toFixed(2));
                          }
                        }}
                        inputMode="decimal"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={editTpBusy}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP1 price</label>
                      <input
                        value={editTp1Price}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditTp1Price(v);
                          const entry = Number(editTpPosition?.entry_price);
                          const price = Number(v);
                          if (Number.isFinite(entry) && entry > 0 && Number.isFinite(price) && price > 0) {
                            setEditTp1Pct((((price - entry) / entry) * 100).toFixed(2));
                          }
                        }}
                        inputMode="decimal"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={editTpBusy}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">TP1 size %</label>
                      <input
                        value={editTp1SizePct}
                        onChange={(e) => setEditTp1SizePct(e.target.value)}
                        inputMode="numeric"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        disabled={editTpBusy}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {editTpPlan === "tp1_tp2" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP2 %</label>
                    <input
                      value={editTp2Pct}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditTp2Pct(v);
                        const entry = Number(editTpPosition?.entry_price);
                        const pct = Number(v);
                        if (Number.isFinite(entry) && entry > 0 && Number.isFinite(pct) && pct > 0) {
                          setEditTp2Price((entry * (1 + pct / 100)).toFixed(2));
                        }
                      }}
                      inputMode="decimal"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      disabled={editTpBusy}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP2 price</label>
                    <input
                      value={editTp2Price}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditTp2Price(v);
                        const entry = Number(editTpPosition?.entry_price);
                        const price = Number(v);
                        if (Number.isFinite(entry) && entry > 0 && Number.isFinite(price) && price > 0) {
                          setEditTp2Pct((((price - entry) / entry) * 100).toFixed(2));
                        }
                      }}
                      inputMode="decimal"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      disabled={editTpBusy}
                    />
                  </div>
                </div>
              ) : null}

              {editTpPlan === "tp1_tp2" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500">TP2 size %</label>
                    <input
                      value={editTp2SizePct}
                      onChange={(e) => setEditTp2SizePct(e.target.value)}
                      inputMode="numeric"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      disabled={editTpBusy}
                    />
                  </div>
                </div>
              ) : null}

              {editTpError ? <div className="text-sm text-rose-600">{editTpError}</div> : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  onClick={closeEditTpModal}
                  disabled={editTpBusy}
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  onClick={submitEditTp}
                  disabled={editTpBusy}
                >
                  {editTpBusy ? "Saving..." : "Save TP plan"}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      ) : (
        // CLOSED
        <div className="space-y-4">
          {hasClosedTrades ? (
            <>
              <ClosedTradeSummaryCards summary={closedSummary} />

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr className="border-b border-slate-200">
                        <th className="p-3">Symbol</th>
                        <th className="p-3">Strategy</th>
                        <th className="p-3">Entry</th>
                        <th className="p-3">Exit</th>
                        <th className="p-3">Reason</th>
                        <th className="p-3">Gross P&L</th>
                        <th className="p-3">Fees</th>
                        <th className="p-3">Net P&L</th>
                        <th className="p-3">Net %</th>
                        <th className="p-3">Closed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedWithPnL.map((p) => {
                        const grossUsd = p.pnl?.grossUsd ?? null;
                        const feesUsd = p.pnl?.feesUsd ?? null;
                        const netUsd = p.pnl?.netUsd ?? null;
                        const pnlPct = p.pnl?.netPct ?? null;
                        const pnlClass =
                          typeof pnlPct === "number"
                            ? pnlPct > 0
                              ? "text-emerald-600"
                              : pnlPct < 0
                                ? "text-rose-600"
                                : "text-slate-600"
                            : "text-slate-500";

                        return (
                          <tr key={p.id} className="border-b border-slate-100">
                            <td className="p-3 font-semibold text-slate-900">{p.symbol}</td>
                            <td className="p-3">
                              <span className={clsx("rounded-full border px-2 py-1 text-xs font-semibold", strategyChipClass(p.strategy_version))}>
                                {strategyLabel(p.strategy_version)}
                              </span>
                            </td>
                            <td className="p-3 text-slate-800">{formatMoney(p.entry_price)}</td>
                            <td className="p-3 text-slate-800">{formatMoney(p.exit_price)}</td>
                            <td className="p-3 text-slate-700">{p.exit_reason ?? "—"}</td>
                            <td className={clsx("p-3 font-medium", typeof grossUsd === "number" && grossUsd > 0 ? "text-emerald-600" : typeof grossUsd === "number" && grossUsd < 0 ? "text-rose-600" : "text-slate-500")}>
                              {formatMoneySigned(grossUsd)}
                            </td>
                            <td className="p-3 text-slate-700">{formatMoney(feesUsd)}</td>
                            <td className={clsx("p-3 font-medium", typeof netUsd === "number" && netUsd > 0 ? "text-emerald-600" : typeof netUsd === "number" && netUsd < 0 ? "text-rose-600" : "text-slate-500")}>
                              {formatMoneySigned(netUsd)}
                            </td>
                            <td className={clsx("p-3 font-semibold", pnlClass)}>
                              {typeof pnlPct === "number" ? formatPct(pnlPct) : "—"}
                            </td>
                            <td className="p-3 text-slate-800">{formatDate(p.closed_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">No closed trades yet</div>
              <div className="mt-1 text-sm text-slate-600">
                When you close your first position with an exit price, your performance summary will appear here.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
