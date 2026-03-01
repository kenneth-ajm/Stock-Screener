"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

type OpenPosition = {
  id: string;
  symbol: string;
  entry_date: string | null;
  entry_price: number | null;
  shares: number | null;
  stop: number | null;
  status: "OPEN";
};

type ClosedPosition = {
  id: string;
  symbol: string;
  entry_date: string | null;
  entry_price: number | null;
  shares: number | null;
  stop: number | null;
  status: "CLOSED";
  closed_at: string | null;
  exit_price: number | null;
};

function fmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "-";
  return Number(n).toFixed(2);
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "-";
  // Keep it simple and stable (avoid timezone drama): show YYYY-MM-DD if present
  return String(s).slice(0, 10);
}

export default function PositionsClient({
  currency,
  accountSize,
  openPositions,
  closedPositions,
}: {
  currency: string;
  accountSize: number;
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"OPEN" | "CLOSED">("OPEN");

  const closedWithPnl = useMemo(() => {
    return closedPositions.map((p) => {
      const entry = Number(p.entry_price);
      const exit = Number(p.exit_price);
      const shares = Number(p.shares);

      const pnl =
        [entry, exit, shares].every(Number.isFinite) ? (exit - entry) * shares : null;

      const pct =
        [entry, exit].every(Number.isFinite) && entry > 0
          ? ((exit / entry) - 1) * 100
          : null;

      return { ...p, pnl, pct };
    });
  }, [closedPositions]);

  async function closePosition(p: OpenPosition) {
    setMsg(null);

    const raw = window.prompt(`Exit price for ${p.symbol} (e.g., 177.50):`);
    if (raw == null) return;

    const exit_price = Number(String(raw).trim());
    if (!Number.isFinite(exit_price) || exit_price <= 0) {
      setMsg(`${p.symbol}: Please enter a valid positive exit price.`);
      return;
    }

    setBusy(p.id);

    try {
      const res = await fetch("/api/positions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_id: p.id, exit_price }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(`${p.symbol}: ${json?.error || `Failed (${res.status})`}`);
        return;
      }

      window.location.reload();
    } catch {
      setMsg(`${p.symbol}: Failed to close position`);
    } finally {
      setBusy(null);
    }
  }

  function riskDollars(p: OpenPosition) {
    const entry = Number(p.entry_price);
    const stop = Number(p.stop);
    const shares = Number(p.shares);
    if (![entry, stop, shares].every(Number.isFinite)) return null;
    return Math.max((entry - stop) * shares, 0);
  }

  function positionValue(p: OpenPosition) {
    const entry = Number(p.entry_price);
    const shares = Number(p.shares);
    if (![entry, shares].every(Number.isFinite)) return null;
    return entry * shares;
  }

  return (
    <div>
      {/* Tabs */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("OPEN")}
            className={[
              "rounded-full px-3 py-1 text-sm border shadow-sm",
              tab === "OPEN"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white border-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            Open ({openPositions.length})
          </button>
          <button
            onClick={() => setTab("CLOSED")}
            className={[
              "rounded-full px-3 py-1 text-sm border shadow-sm",
              tab === "CLOSED"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white border-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            Closed ({closedPositions.length})
          </button>
        </div>
      </div>

      {msg ? (
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          {msg}
        </div>
      ) : null}

      {tab === "OPEN" ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left border-b border-slate-200">
                <th className="py-3 px-4">Symbol</th>
                <th className="py-3 px-4">Entry date</th>
                <th className="py-3 px-4 text-right">Entry</th>
                <th className="py-3 px-4 text-right">Shares</th>
                <th className="py-3 px-4 text-right">Stop</th>
                <th className="py-3 px-4 text-right">Risk ($)</th>
                <th className="py-3 px-4 text-right">Position ($)</th>
                <th className="py-3 px-4 text-right">% Account</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>

            <tbody>
              {openPositions.map((p, idx) => {
                const risk = riskDollars(p);
                const value = positionValue(p);
                const pct =
                  value != null && Number.isFinite(accountSize) && accountSize > 0
                    ? (value / accountSize) * 100
                    : null;

                return (
                  <tr
                    key={p.id}
                    className={[
                      "border-b border-slate-100",
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                      "hover:bg-emerald-50/40 transition-colors",
                    ].join(" ")}
                  >
                    <td className="py-3 px-4 font-mono font-semibold">{p.symbol}</td>
                    <td className="py-3 px-4 font-mono">{p.entry_date ?? "-"}</td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(p.entry_price)}</td>
                    <td className="py-3 px-4 text-right font-mono">
                      {p.shares == null ? "-" : String(p.shares)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">{fmt(p.stop)}</td>
                    <td className="py-3 px-4 text-right font-mono">
                      {risk == null ? "-" : `${currency} ${risk.toFixed(2)}`}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      {value == null ? "-" : `${currency} ${value.toFixed(2)}`}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      {pct == null ? "-" : `${pct.toFixed(1)}%`}
                    </td>
                    <td className="py-3 px-4">
                      <Button
                        variant="secondary"
                        disabled={busy === p.id}
                        onClick={() => closePosition(p)}
                      >
                        {busy === p.id ? "Closing..." : "Close"}
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {openPositions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 px-4 muted">
                    No open positions yet. Go to /screener and “Open” a position.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left border-b border-slate-200">
                <th className="py-3 px-4">Symbol</th>
                <th className="py-3 px-4">Entry</th>
                <th className="py-3 px-4">Closed</th>
                <th className="py-3 px-4 text-right">Entry px</th>
                <th className="py-3 px-4 text-right">Exit px</th>
                <th className="py-3 px-4 text-right">Shares</th>
                <th className="py-3 px-4 text-right">P/L ($)</th>
                <th className="py-3 px-4 text-right">P/L (%)</th>
              </tr>
            </thead>

            <tbody>
              {closedWithPnl.map((p, idx) => (
                <tr
                  key={p.id}
                  className={[
                    "border-b border-slate-100",
                    idx % 2 === 0 ? "bg-white" : "bg-slate-50/40",
                    "hover:bg-emerald-50/40 transition-colors",
                  ].join(" ")}
                >
                  <td className="py-3 px-4 font-mono font-semibold">{p.symbol}</td>
                  <td className="py-3 px-4 font-mono">{fmtDate(p.entry_date)}</td>
                  <td className="py-3 px-4 font-mono">{fmtDate(p.closed_at)}</td>
                  <td className="py-3 px-4 text-right font-mono">{fmt(p.entry_price)}</td>
                  <td className="py-3 px-4 text-right font-mono">{fmt(p.exit_price)}</td>
                  <td className="py-3 px-4 text-right font-mono">
                    {p.shares == null ? "-" : String(p.shares)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">
                    {p.pnl == null ? "-" : `${currency} ${p.pnl.toFixed(2)}`}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">
                    {p.pct == null ? "-" : `${p.pct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}

              {closedPositions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 px-4 muted">
                    No closed positions yet. Close a trade to see history here.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}