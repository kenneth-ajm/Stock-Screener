"use client";

import { useMemo, useState } from "react";
import ClosedTradeSummaryCards from "./ClosedTradeSummaryCards";
import { ClosedTradeSummary, formatPct } from "@/lib/analytics/closedTradeSummary";

type PositionRow = {
  id: string;
  symbol: string;
  status: "OPEN" | "CLOSED" | string;

  entry_price: number | null;
  stop_price?: number | null;

  // optional sizing fields
  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;

  // closing fields
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
  const pnlUsd = (exit - entry) * qty;
  const pnlPct = (exit - entry) / entry;
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
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1020] p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="text-base font-semibold">{title}</div>
            <button
              className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
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

export default function PositionsClient({
  openPositions,
  closedPositions,
  closedSummary,
}: {
  openPositions: PositionRow[];
  closedPositions: PositionRow[];
  closedSummary: ClosedTradeSummary;
}) {
  const [tab, setTab] = useState<"OPEN" | "CLOSED">("OPEN");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [activePosition, setActivePosition] = useState<PositionRow | null>(null);
  const [exitPriceInput, setExitPriceInput] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const closedWithPnL = useMemo(() => {
    return closedPositions.map((p) => {
      const pnl = computeClosedPnL(p);
      return { ...p, pnl };
    });
  }, [closedPositions]);

  function openCloseModal(p: PositionRow) {
    setActivePosition(p);
    setExitPriceInput("");
    setModalError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (submitting) return;
    setModalOpen(false);
    setActivePosition(null);
    setExitPriceInput("");
    setModalError(null);
  }

  async function submitClose() {
    if (!activePosition) return;

    const exitPrice = Number(exitPriceInput);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      setModalError("Please enter a valid positive exit price.");
      return;
    }

    try {
      setSubmitting(true);
      setModalError(null);

      const res = await fetch("/api/positions/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          position_id: activePosition.id,
          exit_price: exitPrice,
        }),
      });

      const payload = await res.json().catch(() => null);

      if (!res.ok || !payload?.ok) {
        const msg =
          payload?.error ||
          (typeof payload === "string" ? payload : null) ||
          "Close failed.";
        throw new Error(msg);
      }

      // Refresh server-rendered data
      window.location.reload();
    } catch (e: any) {
      setModalError(e?.message ?? "Close failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-2">
        <button
          className={clsx(
            "rounded-lg px-3 py-1.5 text-sm",
            tab === "OPEN" ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
          )}
          onClick={() => setTab("OPEN")}
        >
          Open
        </button>
        <button
          className={clsx(
            "rounded-lg px-3 py-1.5 text-sm",
            tab === "CLOSED" ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
          )}
          onClick={() => setTab("CLOSED")}
        >
          Closed
        </button>
      </div>

      {/* OPEN */}
      {tab === "OPEN" ? (
        <div className="rounded-xl border border-white/10 bg-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-white/60">
                <tr className="border-b border-white/10">
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
                    <td className="p-3 text-white/60" colSpan={6}>
                      No open positions.
                    </td>
                  </tr>
                ) : (
                  openPositions.map((p) => (
                    <tr key={p.id} className="border-b border-white/5">
                      <td className="p-3 font-semibold">{p.symbol}</td>
                      <td className="p-3">{formatMoney(p.entry_price)}</td>
                      <td className="p-3">{formatMoney(p.stop_price ?? null)}</td>
                      <td className="p-3">{resolveQty(p) || "—"}</td>
                      <td className="p-3">{formatDate(p.created_at ?? null)}</td>
                      <td className="p-3 text-right">
                        <button
                          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
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

          <Modal
            open={modalOpen}
            title={activePosition ? `Close Position: ${activePosition.symbol}` : "Close Position"}
            onClose={closeModal}
          >
            <div className="space-y-3">
              <div className="text-sm text-white/70">
                Enter the exit price you actually sold at. This will be saved for closed-trade history and P/L.
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-white/60">Exit price</label>
                <input
                  value={exitPriceInput}
                  onChange={(e) => setExitPriceInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 12.34"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20"
                  disabled={submitting}
                />
                {modalError ? (
                  <div className="text-xs text-rose-300">{modalError}</div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                  onClick={closeModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-white/15 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
                  onClick={submitClose}
                  disabled={submitting}
                >
                  {submitting ? "Closing..." : "Confirm Close"}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      ) : (
        /* CLOSED */
        <div className="space-y-4">
          <ClosedTradeSummaryCards summary={closedSummary} />

          <div className="rounded-xl border border-white/10 bg-white/5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-white/60">
                  <tr className="border-b border-white/10">
                    <th className="p-3">Symbol</th>
                    <th className="p-3">Entry</th>
                    <th className="p-3">Exit</th>
                    <th className="p-3">P/L %</th>
                    <th className="p-3">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {closedWithPnL.length === 0 ? (
                    <tr>
                      <td className="p-3 text-white/60" colSpan={5}>
                        No closed positions.
                      </td>
                    </tr>
                  ) : (
                    closedWithPnL.map((p) => {
                      const pnlPct = p.pnl?.pnlPct ?? null;
                      const pnlClass =
                        typeof pnlPct === "number"
                          ? pnlPct > 0
                            ? "text-emerald-300"
                            : pnlPct < 0
                              ? "text-rose-300"
                              : "text-white/70"
                          : "text-white/60";

                      return (
                        <tr key={p.id} className="border-b border-white/5">
                          <td className="p-3 font-semibold">{p.symbol}</td>
                          <td className="p-3">{formatMoney(p.entry_price)}</td>
                          <td className="p-3">{formatMoney(p.exit_price)}</td>
                          <td className={clsx("p-3 font-semibold", pnlClass)}>
                            {typeof pnlPct === "number" ? formatPct(pnlPct) : "—"}
                          </td>
                          <td className="p-3">{formatDate(p.closed_at)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-xs text-white/50">
            Tip: P/L % is computed from entry and exit. $ P/L is available if you store a quantity field (shares/quantity).
          </div>
        </div>
      )}
    </div>
  );
}