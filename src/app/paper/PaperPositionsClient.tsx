"use client";

import { useMemo, useState } from "react";

type PaperStatus = "PENDING" | "OPEN" | "CLOSED" | "STOPPED" | "TP1_HIT" | "TP2_HIT";

type PaperRow = {
  id: string;
  symbol: string;
  strategy_version: string;
  entry_price: number;
  stop_price: number;
  tp1: number | null;
  tp2: number | null;
  shares: number;
  status: PaperStatus;
  reason_summary?: string | null;
  notes?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  exit_price?: number | null;
};

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function statusPill(status: PaperStatus) {
  if (status === "OPEN" || status === "TP1_HIT") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "PENDING") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "CLOSED") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

export default function PaperPositionsClient({
  initialRows,
  latestPriceBySymbol,
}: {
  initialRows: PaperRow[];
  latestPriceBySymbol: Record<string, number | null>;
}) {
  const [rows, setRows] = useState<PaperRow[]>(initialRows ?? []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openRows = useMemo(
    () => rows.filter((r) => !["CLOSED", "STOPPED", "TP1_HIT", "TP2_HIT"].includes(r.status)),
    [rows]
  );
  const closedRows = useMemo(
    () => rows.filter((r) => ["CLOSED", "STOPPED", "TP1_HIT", "TP2_HIT"].includes(r.status)),
    [rows]
  );

  async function updateStatus(row: PaperRow, status: PaperStatus) {
    setBusyId(row.id);
    setError(null);
    try {
      const last = toNum(latestPriceBySymbol[String(row.symbol ?? "").trim().toUpperCase()]);
      const res = await fetch("/api/paper-positions/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          status,
          exit_price: status === "CLOSED" || status === "STOPPED" || status === "TP1_HIT" || status === "TP2_HIT" ? last : null,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok || !payload?.position) {
        throw new Error(payload?.error ?? "Failed to update paper status");
      }
      const next = payload.position as PaperRow;
      setRows((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p)));
    } catch (e: any) {
      setError(e?.message ?? "Failed to update paper status");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
        <div className="mb-3 text-sm font-semibold text-slate-800">Open paper positions</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-[#eadfce]">
                <th className="px-2 py-2">Symbol</th>
                <th className="px-2 py-2">Strategy</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Entry</th>
                <th className="px-2 py-2">Stop</th>
                <th className="px-2 py-2">TP1</th>
                <th className="px-2 py-2">TP2</th>
                <th className="px-2 py-2">Shares</th>
                <th className="px-2 py-2">Last</th>
                <th className="px-2 py-2">Unrealized</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {openRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-2 py-4 text-slate-500">
                    No open paper positions.
                  </td>
                </tr>
              ) : null}
              {openRows.map((row) => {
                const last = toNum(latestPriceBySymbol[String(row.symbol ?? "").trim().toUpperCase()]);
                const entry = toNum(row.entry_price);
                const shares = toNum(row.shares) ?? 0;
                const unrealized = last != null && entry != null ? (last - entry) * shares : null;
                return (
                  <tr key={row.id} className="border-b border-[#f1e9dc]">
                    <td className="px-2 py-2 font-semibold">{row.symbol}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">{row.strategy_version}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPill(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-2 py-2">{money(entry)}</td>
                    <td className="px-2 py-2">{money(toNum(row.stop_price))}</td>
                    <td className="px-2 py-2">{money(toNum(row.tp1))}</td>
                    <td className="px-2 py-2">{money(toNum(row.tp2))}</td>
                    <td className="px-2 py-2">{shares}</td>
                    <td className="px-2 py-2">{money(last)}</td>
                    <td className="px-2 py-2">{money(unrealized)}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          disabled={busyId === row.id}
                          onClick={() => updateStatus(row, "CLOSED")}
                          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                        >
                          Close
                        </button>
                        <button
                          disabled={busyId === row.id}
                          onClick={() => updateStatus(row, "STOPPED")}
                          className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700"
                        >
                          Stop
                        </button>
                        <button
                          disabled={busyId === row.id}
                          onClick={() => updateStatus(row, "TP1_HIT")}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                        >
                          TP1
                        </button>
                        <button
                          disabled={busyId === row.id}
                          onClick={() => updateStatus(row, "TP2_HIT")}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                        >
                          TP2
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
        <div className="mb-3 text-sm font-semibold text-slate-800">Closed paper positions</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-[#eadfce]">
                <th className="px-2 py-2">Symbol</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Entry</th>
                <th className="px-2 py-2">Exit</th>
                <th className="px-2 py-2">Shares</th>
                <th className="px-2 py-2">Realized</th>
                <th className="px-2 py-2">Opened</th>
                <th className="px-2 py-2">Closed</th>
              </tr>
            </thead>
            <tbody>
              {closedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-slate-500">
                    No closed paper positions.
                  </td>
                </tr>
              ) : null}
              {closedRows.map((row) => {
                const entry = toNum(row.entry_price);
                const exit = toNum(row.exit_price);
                const shares = toNum(row.shares) ?? 0;
                const realized = entry != null && exit != null ? (exit - entry) * shares : null;
                return (
                  <tr key={row.id} className="border-b border-[#f1e9dc]">
                    <td className="px-2 py-2 font-semibold">{row.symbol}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPill(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-2 py-2">{money(entry)}</td>
                    <td className="px-2 py-2">{money(exit)}</td>
                    <td className="px-2 py-2">{shares}</td>
                    <td className="px-2 py-2">{money(realized)}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">{row.opened_at ? String(row.opened_at).slice(0, 10) : "—"}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">{row.closed_at ? String(row.closed_at).slice(0, 10) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
