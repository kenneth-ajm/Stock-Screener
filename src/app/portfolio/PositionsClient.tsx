"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Position = {
  id: string;
  symbol: string;
  entry_date: string | null;
  entry_price: number | null;
  shares: number | null;
  stop: number | null;
  status: "OPEN" | "CLOSED";
};

function fmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "-";
  return Number(n).toFixed(2);
}

export default function PositionsClient({
  currency,
  accountSize,
  positions,
}: {
  currency: string;
  accountSize: number;
  positions: Position[];
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function closePosition(id: string, symbol: string) {
    setMsg(null);
    setBusy(id);

    try {
      const res = await fetch("/api/positions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_id: id }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(`${symbol}: ${json?.error || `Failed (${res.status})`}`);
        return;
      }

      // simplest: refresh page to re-fetch server data
      window.location.reload();
    } catch (e) {
      setMsg(`${symbol}: Failed to close position`);
    } finally {
      setBusy(null);
    }
  }

  function riskDollars(p: Position) {
    const entry = Number(p.entry_price);
    const stop = Number(p.stop);
    const shares = Number(p.shares);
    if (![entry, stop, shares].every(Number.isFinite)) return null;
    return Math.max((entry - stop) * shares, 0);
  }

  function positionValue(p: Position) {
    const entry = Number(p.entry_price);
    const shares = Number(p.shares);
    if (![entry, shares].every(Number.isFinite)) return null;
    return entry * shares;
  }

  return (
    <div>
      {msg ? (
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          {msg}
        </div>
      ) : null}

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
            {positions.map((p, idx) => {
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
                      onClick={() => closePosition(p.id, p.symbol)}
                    >
                      {busy === p.id ? "Closing..." : "Close"}
                    </Button>
                  </td>
                </tr>
              );
            })}

            {positions.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 px-4 muted">
                  No open positions yet. Go to /screener and “Open” a position.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}