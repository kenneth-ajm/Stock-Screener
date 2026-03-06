"use client";

import { useEffect, useMemo, useState } from "react";

type StrategyVersion = "v2_core_momentum" | "v1_trend_hold";

type IdeaRow = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  rank?: number | null;
  rank_score?: number | null;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  reason_summary?: string | null;
  action?: "BUY_NOW" | "WAIT" | "SKIP";
  sizing?: { shares: number; est_cost: number; risk_per_share: number; risk_budget: number };
};

type Payload = {
  ok: boolean;
  meta?: { lctd: string | null; regime_state: string | null };
  capacity?: {
    cash_available: number;
    cash_source: "manual" | "estimated";
    slots_left: number;
  } | null;
  rows?: IdeaRow[];
  error?: string;
};

export default function IdeasWorkspaceClient({
  initialStrategy = "v2_core_momentum",
}: {
  initialStrategy?: StrategyVersion;
}) {
  const [strategy, setStrategy] = useState<StrategyVersion>(initialStrategy);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IdeaRow | null>(null);
  const [fill, setFill] = useState("");
  const [shares, setShares] = useState("");
  const [details, setDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`/api/screener-data?strategy_version=${strategy}&universe_slug=core_800`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((json) => mounted && setData(json))
      .catch((e) => mounted && setData({ ok: false, error: e instanceof Error ? e.message : "Load failed" }))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [strategy]);

  useEffect(() => {
    if (!selected) return;
    setFill(String(selected.entry ?? ""));
    setShares(String(selected.sizing?.shares ?? 0));
    setDetails(null);
    setError(null);
  }, [selected]);

  const rows = useMemo(() => (data?.rows ?? []).slice(0, 10), [data]);
  const fillNum = Number(fill);
  const stopNum = Number(selected?.stop ?? 0);
  const riskPerShare = fillNum > 0 && stopNum > 0 ? fillNum - stopNum : 0;
  const riskBudget = Number(selected?.sizing?.risk_budget ?? 0);
  const suggestedShares =
    riskPerShare > 0 && Number.isFinite(riskBudget) ? Math.max(0, Math.floor(riskBudget / riskPerShare)) : 0;
  const sharesNum = Number(shares);
  const positionCost = Number.isFinite(sharesNum) && Number.isFinite(fillNum) ? sharesNum * fillNum : 0;

  async function openDetails() {
    if (!selected || detailsLoading || details) return;
    setDetailsLoading(true);
    try {
      const query = new URLSearchParams({
        symbol: selected.symbol,
        strategy_version: strategy,
        universe_slug: "core_800",
        date: data?.meta?.lctd ?? "",
      });
      const res = await fetch(`/api/scan-row-detail?${query.toString()}`, { cache: "no-store" });
      const payload = await res.json().catch(() => null);
      setDetails(payload);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function addPosition() {
    if (!selected) return;
    const entry = Number(fill);
    const stop = Number(selected.stop);
    const qty = Math.floor(Number(shares));
    if (!(entry > 0) || !(stop > 0) || !(qty > 0) || !(entry > stop)) {
      setError("Enter valid entry, stop, and shares.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/positions/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: selected.symbol,
          entry_price: entry,
          stop,
          shares: qty,
          strategy_version: strategy,
          max_hold_days: strategy === "v1_trend_hold" ? 45 : 7,
          tp_model: strategy === "v1_trend_hold" ? "percent_10_20" : "percent_5_10",
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? "Add position failed");
      setSelected(null);
      window.location.href = "/positions";
    } catch (e: any) {
      setError(e?.message ?? "Add position failed");
    } finally {
      setSaving(false);
    }
  }

  function signalPill(signal: "BUY" | "WATCH" | "AVOID") {
    if (signal === "BUY") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (signal === "WATCH") return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dfcfb2] bg-[#fff7ec] p-3.5">
        <div className="flex items-center gap-2 rounded-xl border border-[#e5d8c4] bg-[#fbf6ee] p-1.5">
          <button
            onClick={() => setStrategy("v2_core_momentum")}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium ${
              strategy === "v2_core_momentum"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f1e8da]"
            }`}
          >
            Momentum Swing
          </button>
          <button
            onClick={() => setStrategy("v1_trend_hold")}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium ${
              strategy === "v1_trend_hold"
                ? "border-[#d8c7a8] bg-[#efe2cb] text-slate-900"
                : "border-transparent bg-transparent text-slate-700 hover:bg-[#f1e8da]"
            }`}
          >
            Trend Hold
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-[#e1d2ba] bg-[#fffdf8] px-2 py-1">Regime: {data?.meta?.regime_state ?? "—"}</span>
          <span className="rounded-full border border-[#e1d2ba] bg-[#fffdf8] px-2 py-1">LCTD: {data?.meta?.lctd ?? "—"}</span>
          <span className="rounded-full border border-[#e1d2ba] bg-[#fffdf8] px-2 py-1">
            Cash: {Number(data?.capacity?.cash_available ?? 0).toFixed(2)}
          </span>
          <span className="rounded-full border border-[#e1d2ba] bg-[#fffdf8] px-2 py-1">
            Slots: {data?.capacity?.slots_left ?? 0}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#dfcfb2] bg-[#fff7ec] shadow-[0_8px_24px_rgba(88,63,36,0.04)]">
        {loading ? <div className="p-4 text-sm text-slate-600">Loading ideas…</div> : null}
        {!loading && !data?.ok ? <div className="p-4 text-sm text-rose-600">Failed: {data?.error ?? "Unknown error"}</div> : null}
        {!loading && data?.ok ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-[#e2d2b7]">
                <th className="p-3">Symbol</th>
                <th className="p-3">Signal</th>
                <th className="p-3">Rank</th>
                <th className="p-3">Entry</th>
                <th className="p-3">Stop</th>
                <th className="p-3">TP1</th>
                <th className="p-3">Position Cost</th>
                <th className="p-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.symbol}
                  className="cursor-pointer border-b border-[#efe5d6] transition hover:bg-[#fff9f0]"
                  onClick={() => setSelected(row)}
                >
                  <td className="p-3 font-semibold tracking-tight">{row.symbol}</td>
                  <td className="p-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${signalPill(row.signal)}`}>
                      {row.signal}
                    </span>
                  </td>
                  <td className="p-3">{row.rank ?? "—"}</td>
                  <td className="p-3">{Number(row.entry ?? 0).toFixed(2)}</td>
                  <td className="p-3">{Number(row.stop ?? 0).toFixed(2)}</td>
                  <td className="p-3">{Number(row.tp1 ?? 0).toFixed(2)}</td>
                  <td className="p-3">{Number(row.sizing?.est_cost ?? 0).toFixed(2)}</td>
                  <td className="max-w-[420px] truncate p-3 text-slate-600">{row.reason_summary ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-xl transform border-l border-[#e0cfb1] bg-[#fff8ee] shadow-2xl transition ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[#e3d2b6] px-4 py-3">
              <div>
                <div className="text-lg font-semibold">{selected.symbol}</div>
                <div className="text-xs text-slate-500">{strategy === "v1_trend_hold" ? "Trend Hold" : "Momentum Swing"}</div>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg border border-[#dcc9aa] bg-[#f3e7d3] px-2.5 py-1 text-xs font-medium">
                Close
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                  <div className="text-xs text-slate-500">Model entry</div>
                  <div className="mt-1 font-semibold">{selected.entry.toFixed(2)}</div>
                </div>
                <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                  <div className="text-xs text-slate-500">Stop</div>
                  <div className="mt-1 font-semibold">{selected.stop.toFixed(2)}</div>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                <label className="block text-xs text-slate-500">Your entry</label>
                <input
                  value={fill}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFill(next);
                    const n = Number(next);
                    if (Number.isFinite(n) && n > 0 && selected.stop > 0 && riskBudget > 0) {
                      const nextRisk = n - selected.stop;
                      if (nextRisk > 0) setShares(String(Math.floor(riskBudget / nextRisk)));
                    }
                  }}
                  className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                  inputMode="decimal"
                />
                <label className="block text-xs text-slate-500">Shares</label>
                <input
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  className="w-full rounded-lg border border-[#e5d8c4] bg-white px-3 py-2"
                  inputMode="numeric"
                />
                <div className="text-xs text-slate-600">
                  Suggested shares (fill-aware): <span className="font-semibold">{suggestedShares}</span>
                </div>
              </div>

              <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3 text-xs text-slate-600">
                <div>Risk/share: {Number.isFinite(riskPerShare) ? riskPerShare.toFixed(2) : "—"}</div>
                <div>Risk budget: {Number.isFinite(riskBudget) ? riskBudget.toFixed(2) : "—"}</div>
                <div>Position cost: {Number.isFinite(positionCost) ? positionCost.toFixed(2) : "—"}</div>
                <div>TP1 / TP2: {selected.tp1.toFixed(2)} / {selected.tp2.toFixed(2)}</div>
              </div>

              <div className="rounded-xl border border-[#e5d8c4] bg-[#fffdf8] p-3">
                <button
                  onClick={openDetails}
                  className="text-xs text-slate-600 underline"
                  disabled={detailsLoading}
                >
                  {detailsLoading ? "Loading details…" : "Load details / explainability"}
                </button>
                {details ? (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-2 text-[11px] text-slate-100">
{JSON.stringify(details, null, 2)}
                  </pre>
                ) : null}
              </div>
              {error ? <div className="text-sm text-rose-600">{error}</div> : null}
            </div>
            <div className="border-t border-[#e3d2b6] p-4">
              <button
                onClick={addPosition}
                disabled={saving}
                className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Adding..." : "Add Position"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
