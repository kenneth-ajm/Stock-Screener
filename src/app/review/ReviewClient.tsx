"use client";

import { useMemo, useState } from "react";

type TradeRow = {
  id: string;
  symbol: string;
  strategy: string | null;
  entry_price: number;
  exit_price: number;
  shares: number;
  entry_date: string | null;
  exit_date: string | null;
  fees: number;
  exit_reason: string | null;
  notes: string | null;
  holding_days: number | null;
  return_pct: number | null;
  net_pnl: number | null;
};

type SortKey = "return_pct" | "net_pnl" | "holding_days";

function fmtMoney(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export default function ReviewClient({ initialTrades }: { initialTrades: TradeRow[] }) {
  const [trades, setTrades] = useState<TradeRow[]>(initialTrades);
  const [sortBy, setSortBy] = useState<SortKey>("return_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const sorted = useMemo(() => {
    const list = [...trades];
    list.sort((a, b) => {
      const av = a[sortBy] ?? Number.NEGATIVE_INFINITY;
      const bv = b[sortBy] ?? Number.NEGATIVE_INFINITY;
      if (av === bv) return a.symbol.localeCompare(b.symbol);
      return sortDir === "desc" ? (Number(bv) - Number(av)) : (Number(av) - Number(bv));
    });
    return list;
  }, [trades, sortBy, sortDir]);

  const selected = selectedId ? trades.find((t) => t.id === selectedId) ?? null : null;

  function openTrade(t: TradeRow) {
    setSelectedId(t.id);
    setEditReason(t.exit_reason ?? "");
    setEditNotes(t.notes ?? "");
    setSaveError(null);
  }

  async function saveTrade() {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/review/update-trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          exit_reason: editReason.trim() || null,
          notes: editNotes.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Update failed (${res.status})`);
      }
      setTrades((prev) =>
        prev.map((row) =>
          row.id === selected.id
            ? { ...row, exit_reason: editReason.trim() || null, notes: editNotes.trim() || null }
            : row
        )
      );
      setSelectedId(null);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function sortButton(label: string, key: SortKey) {
    const active = sortBy === key;
    return (
      <button
        type="button"
        onClick={() => {
          if (sortBy === key) {
            setSortDir((d) => (d === "desc" ? "asc" : "desc"));
          } else {
            setSortBy(key);
            setSortDir("desc");
          }
        }}
        className={`rounded-lg border px-2 py-1 text-xs ${
          active ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900" : "border-[#e4d7c3] bg-[#fffaf2] text-slate-600"
        }`}
      >
        {label} {active ? (sortDir === "desc" ? "↓" : "↑") : ""}
      </button>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eadfce] p-3">
          <div className="text-sm font-medium text-slate-700">Closed Trades</div>
          <div className="flex items-center gap-2">
            {sortButton("Return %", "return_pct")}
            {sortButton("P/L", "net_pnl")}
            {sortButton("Holding", "holding_days")}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-[#eadfce]">
                <th className="p-3">Symbol</th>
                <th className="p-3">Strategy</th>
                <th className="p-3">Entry</th>
                <th className="p-3">Exit</th>
                <th className="p-3">Return %</th>
                <th className="p-3">P/L $</th>
                <th className="p-3">Holding Days</th>
                <th className="p-3">Exit Reason</th>
                <th className="p-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-3 text-slate-500">
                    No closed trades yet.
                  </td>
                </tr>
              ) : (
                sorted.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => openTrade(t)}
                    className="cursor-pointer border-b border-[#f0e7d9] hover:bg-[#fff8ee]"
                  >
                    <td className="p-3 font-medium">{t.symbol}</td>
                    <td className="p-3">{t.strategy ?? "—"}</td>
                    <td className="p-3">{fmtMoney(t.entry_price)}</td>
                    <td className="p-3">{fmtMoney(t.exit_price)}</td>
                    <td className={`p-3 font-medium ${Number(t.return_pct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtPct(t.return_pct)}
                    </td>
                    <td className={`p-3 font-medium ${Number(t.net_pnl ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtMoney(t.net_pnl)}
                    </td>
                    <td className="p-3">{t.holding_days ?? "—"}</td>
                    <td className="p-3">{t.exit_reason ?? "—"}</td>
                    <td className="max-w-[220px] truncate p-3 text-slate-600">{t.notes ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-lg transform border-l border-[#eadfce] bg-[#fffdf8] shadow-2xl transition ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[#eadfce] px-4 py-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">{selected.symbol}</div>
                <div className="text-xs text-slate-500">{selected.strategy ?? "—"}</div>
              </div>
              <button
                className="rounded-lg border border-[#e2d4be] bg-[#f6eee0] px-2.5 py-1 text-xs font-medium"
                onClick={() => setSelectedId(null)}
              >
                Close
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#eadfce] bg-[#fffaf2] p-3">
                  <div className="text-xs text-slate-500">Entry</div>
                  <div className="mt-1 font-semibold">{fmtMoney(selected.entry_price)}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffaf2] p-3">
                  <div className="text-xs text-slate-500">Exit</div>
                  <div className="mt-1 font-semibold">{fmtMoney(selected.exit_price)}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffaf2] p-3">
                  <div className="text-xs text-slate-500">Shares</div>
                  <div className="mt-1 font-semibold">{selected.shares}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffaf2] p-3">
                  <div className="text-xs text-slate-500">Holding days</div>
                  <div className="mt-1 font-semibold">{selected.holding_days ?? "—"}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffaf2] p-3">
                  <div className="text-xs text-slate-500">Return %</div>
                  <div className={`mt-1 font-semibold ${Number(selected.return_pct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {fmtPct(selected.return_pct)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffaf2] p-3">
                  <div className="text-xs text-slate-500">P/L</div>
                  <div className={`mt-1 font-semibold ${Number(selected.net_pnl ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {fmtMoney(selected.net_pnl)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffaf2] p-3">
                  <div className="text-xs text-slate-500">Fees</div>
                  <div className="mt-1 font-semibold">{fmtMoney(selected.fees)}</div>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-[#eadfce] bg-[#fffaf2] p-3">
                <label className="block text-xs text-slate-500">Exit reason</label>
                <input
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  className="w-full rounded-lg border border-[#eadfce] bg-white px-3 py-2"
                />
                <label className="block text-xs text-slate-500">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg border border-[#eadfce] bg-white px-3 py-2"
                />
                {saveError ? <div className="text-xs text-rose-600">{saveError}</div> : null}
              </div>
            </div>
            <div className="border-t border-[#eadfce] p-4">
              <button
                onClick={saveTrade}
                disabled={saving}
                className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

