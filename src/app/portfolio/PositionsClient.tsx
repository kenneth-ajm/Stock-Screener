"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ClosedTradeSummaryCards from "./ClosedTradeSummaryCards";
import { ClosedTradeSummary, formatPct } from "@/lib/analytics/closedTradeSummary";

type PositionRow = {
  id: string;
  symbol: string;
  status: "OPEN" | "CLOSED" | string;

  entry_price: number | null;
  stop_price?: number | null;

  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;

  exit_price: number | null;
  closed_at: string | null;

  created_at?: string | null;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function formatMoney(x: number | null | undefined) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `$${x.toFixed(2)}`;
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

function computeClosedPnL(p: PositionRow) {
  const entry = p.entry_price ?? null;
  const exit = p.exit_price ?? null;
  if (typeof entry !== "number" || typeof exit !== "number" || entry <= 0) return null;

  const qty = resolveQty(p);
  const pnlPct = (exit - entry) / entry;
  const pnlUsd = (exit - entry) * qty;
  return { pnlUsd, pnlPct };
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
}: {
  openPositions: PositionRow[];
  closedPositions: PositionRow[];
  closedSummary: ClosedTradeSummary;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<"OPEN" | "CLOSED">("OPEN");

  // toast
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  // Close modal state
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [activePosition, setActivePosition] = useState<PositionRow | null>(null);
  const [exitPriceInput, setExitPriceInput] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // Manual add modal state
  const [manualOpen, setManualOpen] = useState(false);
  const [mSymbol, setMSymbol] = useState("");
  const [mEntry, setMEntry] = useState("");
  const [mStop, setMStop] = useState("");
  const [mQty, setMQty] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  const closedWithPnL = useMemo(() => {
    return closedPositions.map((p) => ({ ...p, pnl: computeClosedPnL(p) }));
  }, [closedPositions]);

  const hasClosedTrades = (closedSummary?.trades ?? 0) > 0;

  function openCloseModal(p: PositionRow) {
    setActivePosition(p);
    setExitPriceInput("");
    setCloseError(null);
    setCloseModalOpen(true);
  }

  function closeCloseModal() {
    if (closing) return;
    setCloseModalOpen(false);
    setActivePosition(null);
    setExitPriceInput("");
    setCloseError(null);
  }

  async function submitClose() {
    if (!activePosition) return;

    const exitPrice = Number(exitPriceInput);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      setCloseError("Please enter a valid positive exit price.");
      return;
    }

    try {
      setClosing(true);
      setCloseError(null);

      const res = await fetch("/api/positions/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position_id: activePosition.id, exit_price: exitPrice }),
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

  function openManual() {
    setTab("OPEN");
    setMSymbol("");
    setMEntry("");
    setMStop("");
    setMQty("");
    setManualError(null);
    setManualOpen(true);
  }

  function closeManual() {
    if (manualBusy) return;
    setManualOpen(false);
    setManualError(null);
  }

  async function submitManual() {
    const symbol = mSymbol.trim().toUpperCase();
    const entry = Number(mEntry);
    const stop = Number(mStop);
    const qty = Number(mQty);

    if (!symbol) return setManualError("Symbol is required (e.g. AAPL).");
    if (!Number.isFinite(entry) || entry <= 0)
      return setManualError("Entry price must be a positive number.");
    if (mStop.trim() && (!Number.isFinite(stop) || stop <= 0))
      return setManualError("Stop must be blank or a positive number.");
    if (mQty.trim() && (!Number.isFinite(qty) || qty <= 0))
      return setManualError("Quantity must be blank or a positive number.");

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

  // Auto-open manual add modal if /portfolio?manualAdd=1
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (didAutoOpenRef.current) return;

    const v = searchParams?.get("manualAdd");
    const shouldOpen = v === "1" || v === "true" || v === "yes";

    if (shouldOpen) {
      didAutoOpenRef.current = true;
      openManual();

      // Clean URL so refresh doesn't re-open modal
      router.replace("/portfolio", { scroll: false });
    }
  }, [searchParams, router]); // openManual is stable enough here

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
      </div>

      {/* OPEN */}
      {tab === "OPEN" ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 p-3 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-900">Open positions</div>
            <button
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              onClick={openManual}
            >
              + Add Existing Holding
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Entry</th>
                  <th className="p-3">Stop</th>
                  <th className="p-3">Qty</th>
                  <th className="p-3">Opened</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.length === 0 ? (
                  <tr>
                    <td className="p-3 text-slate-500" colSpan={6}>
                      No open positions.
                    </td>
                  </tr>
                ) : (
                  openPositions.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="p-3 font-semibold text-slate-900">{p.symbol}</td>
                      <td className="p-3 text-slate-800">{formatMoney(p.entry_price)}</td>
                      <td className="p-3 text-slate-800">{formatMoney(p.stop_price ?? null)}</td>
                      <td className="p-3 text-slate-800">{resolveQty(p) || "—"}</td>
                      <td className="p-3 text-slate-800">{formatDate(p.created_at ?? null)}</td>
                      <td className="p-3 text-right">
                        <button
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50"
                          onClick={() => openCloseModal(p)}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
                        <th className="p-3">Entry</th>
                        <th className="p-3">Exit</th>
                        <th className="p-3">P/L %</th>
                        <th className="p-3">Closed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedWithPnL.map((p) => {
                        const pnlPct = p.pnl?.pnlPct ?? null;
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
                            <td className="p-3 text-slate-800">{formatMoney(p.entry_price)}</td>
                            <td className="p-3 text-slate-800">{formatMoney(p.exit_price)}</td>
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