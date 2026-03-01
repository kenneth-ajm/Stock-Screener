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

export default function PositionsClient({
  openPositions,
  closedPositions,
  closedSummary,
  onClosePosition,
}: {
  openPositions: PositionRow[];
  closedPositions: PositionRow[];
  closedSummary: ClosedTradeSummary;
  // keep your existing close handler signature if you already have one
  onClosePosition?: (positionId: string, exitPrice: number) => Promise<void>;
}) {
  const [tab, setTab] = useState<"OPEN" | "CLOSED">("OPEN");
  const [closingId, setClosingId] = useState<string | null>(null);

  const closedWithPnL = useMemo(() => {
    return closedPositions.map((p) => {
      const pnl = computeClosedPnL(p);
      return { ...p, pnl };
    });
  }, [closedPositions]);

  async function handleClose(positionId: string) {
    // If you already have a modal, keep it. For now, we keep prompt to avoid scope creep.
    const raw = window.prompt("Exit price (required):");
    if (!raw) return;
    const exitPrice = Number(raw);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      window.alert("Please enter a valid exit price.");
      return;
    }

    try {
      setClosingId(positionId);

      if (onClosePosition) {
        await onClosePosition(positionId, exitPrice);
      } else {
        // default: call your existing API
        const res = await fetch("/api/positions/close", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ position_id: positionId, exit_price: exitPrice }),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || "Close failed");
        }
      }

      // refresh the page data from server
      window.location.reload();
    } catch (e: any) {
      window.alert(e?.message ?? "Close failed");
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="space-y-4">
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
                          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15 disabled:opacity-50"
                          onClick={() => handleClose(p.id)}
                          disabled={closingId === p.id}
                        >
                          {closingId === p.id ? "Closing..." : "Close"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
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