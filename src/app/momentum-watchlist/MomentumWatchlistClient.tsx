"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SetupType =
  | "EARLY_BASE"
  | "BREAKOUT_NEAR"
  | "BREAKOUT_CONFIRMED"
  | "PULLBACK_RETEST"
  | "EXTENDED_DO_NOT_CHASE"
  | "FAILED_BREAKOUT"
  | "NO_TRADE"
  | "INSUFFICIENT_DATA";

type MomentumRow = {
  symbol: string;
  name: string;
  theme: string;
  popularLiquid: boolean;
  sourceDate: string | null;
  lastClose: number | null;
  previousClose: number | null;
  changePct: number | null;
  avgVolume20: number | null;
  relativeVolume: number | null;
  high5: number | null;
  high20: number | null;
  low20: number | null;
  sma5: number | null;
  sma10: number | null;
  sma20: number | null;
  atr14: number | null;
  setup: SetupType;
  entryTrigger: number | null;
  pullbackEntry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  riskPerShare: number | null;
  rewardRiskTp1: number | null;
  rewardRiskTp2: number | null;
  extended: boolean;
  doNotChase: boolean;
  nearBreakout: boolean;
  insufficientData: boolean;
  reasonSummary: string;
  reasonJson?: {
    distance_to_5d_high_pct?: number | null;
    distance_to_20d_high_pct?: number | null;
  };
};

type Payload = {
  ok: boolean;
  rows?: MomentumRow[];
  meta?: {
    source_date?: string | null;
    watchlist_size?: number;
    horizon?: string;
  };
  error?: string;
};

type MaxPriceFilter = "50" | "100" | "all";
type SetupFilter = "ALL" | SetupType;

const SETUP_OPTIONS: Array<{ value: SetupFilter; label: string }> = [
  { value: "ALL", label: "All setups" },
  { value: "BREAKOUT_CONFIRMED", label: "Breakout confirmed" },
  { value: "BREAKOUT_NEAR", label: "Breakout near" },
  { value: "PULLBACK_RETEST", label: "Pullback retest" },
  { value: "EARLY_BASE", label: "Early base" },
  { value: "NO_TRADE", label: "No trade" },
  { value: "EXTENDED_DO_NOT_CHASE", label: "Extended" },
  { value: "FAILED_BREAKOUT", label: "Failed breakout" },
  { value: "INSUFFICIENT_DATA", label: "Insufficient data" },
];

function fmtMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(2)}`;
}

function fmtPct(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function fmtNum(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function fmtVolume(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value.toFixed(0)}`;
}

function setupLabel(value: SetupType) {
  if (value === "EXTENDED_DO_NOT_CHASE") return "Do not chase";
  if (value === "INSUFFICIENT_DATA") return "Insufficient";
  return value
    .split("_")
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");
}

function setupClass(value: SetupType) {
  switch (value) {
    case "BREAKOUT_CONFIRMED":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "BREAKOUT_NEAR":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "PULLBACK_RETEST":
      return "border-indigo-200 bg-indigo-50 text-indigo-800";
    case "EARLY_BASE":
      return "border-violet-200 bg-violet-50 text-violet-800";
    case "EXTENDED_DO_NOT_CHASE":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "FAILED_BREAKOUT":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "INSUFFICIENT_DATA":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export default function MomentumWatchlistClient() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupFilter, setSetupFilter] = useState<SetupFilter>("ALL");
  const [maxPrice, setMaxPrice] = useState<MaxPriceFilter>("50");
  const [minRvol, setMinRvol] = useState("0");
  const [hideExtended, setHideExtended] = useState(true);
  const [hideFailed, setHideFailed] = useState(true);
  const [popularOnly, setPopularOnly] = useState(false);

  const loadWatchlist = useCallback(async (opts?: { refresh?: boolean; cancelled?: () => boolean }) => {
    const isRefresh = Boolean(opts?.refresh);
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/momentum-watchlist", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as Payload | null;
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        if (!opts?.cancelled?.()) {
          setPayload(json);
          setError(null);
          setLastRefreshedAt(new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        }
    } catch (e: unknown) {
      if (!opts?.cancelled?.()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!opts?.cancelled?.()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadWatchlist({ cancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [loadWatchlist]);

  const rows = useMemo(() => payload?.rows ?? [], [payload?.rows]);
  const minRvolNum = Number(minRvol);
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (setupFilter !== "ALL" && row.setup !== setupFilter) return false;
      if (maxPrice !== "all" && row.lastClose != null && row.lastClose > Number(maxPrice)) return false;
      if (Number.isFinite(minRvolNum) && minRvolNum > 0 && Number(row.relativeVolume ?? 0) < minRvolNum) return false;
      if (hideExtended && row.setup === "EXTENDED_DO_NOT_CHASE") return false;
      if (hideFailed && row.setup === "FAILED_BREAKOUT") return false;
      if (popularOnly && !row.popularLiquid) return false;
      return true;
    });
  }, [hideExtended, hideFailed, maxPrice, minRvolNum, popularOnly, rows, setupFilter]);

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        if (row.setup === "BREAKOUT_CONFIRMED" || row.setup === "BREAKOUT_NEAR" || row.setup === "PULLBACK_RETEST") acc.actionable += 1;
        if (row.setup === "EXTENDED_DO_NOT_CHASE") acc.extended += 1;
        if (row.setup === "FAILED_BREAKOUT") acc.failed += 1;
        if (row.popularLiquid) acc.popular += 1;
        return acc;
      },
      { actionable: 0, extended: 0, failed: 0, popular: 0 }
    );
  }, [rows]);

  return (
    <div className="space-y-5">
      <section className="surface-panel p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="surface-card px-3 py-2.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actionable</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{counts.actionable}</div>
          </div>
          <div className="surface-card px-3 py-2.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extended</div>
            <div className="mt-1 text-2xl font-semibold text-amber-700">{counts.extended}</div>
          </div>
          <div className="surface-card px-3 py-2.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Failed</div>
            <div className="mt-1 text-2xl font-semibold text-rose-700">{counts.failed}</div>
          </div>
          <div className="surface-card px-3 py-2.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest bars</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{payload?.meta?.source_date ?? "-"}</div>
            <div className="mt-1 text-[11px] text-slate-500">
              {lastRefreshedAt ? `Refreshed ${lastRefreshedAt}` : "Refresh uses cached bars"}
            </div>
          </div>
        </div>
      </section>

      <section className="surface-panel p-4">
        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filters</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-medium text-slate-600">
                Setup type
                <select
                  value={setupFilter}
                  onChange={(e) => setSetupFilter(e.target.value as SetupFilter)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800"
                >
                  {SETUP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Max price
                <select
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value as MaxPriceFilter)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800"
                >
                  <option value="50">Under $50</option>
                  <option value="100">Under $100</option>
                  <option value="all">All prices</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Min RVOL
                <input
                  value={minRvol}
                  onChange={(e) => setMinRvol(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800"
                  placeholder="0"
                />
              </label>
              <div className="flex flex-col justify-end gap-2 text-xs font-medium text-slate-700">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={hideExtended} onChange={(e) => setHideExtended(e.target.checked)} />
                  Hide extended
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={hideFailed} onChange={(e) => setHideFailed(e.target.checked)} />
                  Hide failed
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={popularOnly} onChange={(e) => setPopularOnly(e.target.checked)} />
                  Popular/liquid only
                </label>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900">
            This scanner uses daily cached data and highlights possible 1-2 day momentum setups. It is not live intraday confirmation. Confirm price action, volume, VWAP, and breakout behavior in your broker before entering.
          </div>
        </div>
      </section>

      <section className="surface-panel overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">My Trading Style Scanner</div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Fast Momentum Watchlist</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-medium text-slate-500">
                Showing {filteredRows.length} of {rows.length}
              </div>
              <button
                type="button"
                onClick={() => void loadWatchlist({ refresh: true })}
                disabled={loading || refreshing}
                className="rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-1.5 text-xs font-semibold text-fuchsia-800 transition hover:bg-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Refresh re-runs the Fast Momentum calculations on the newest cached daily bars. It does not fetch new Polygon bars.
          </div>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-sm text-slate-600">Loading momentum watchlist...</div>
        ) : error ? (
          <div className="px-4 py-8 text-sm text-rose-700">Could not load scanner: {error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-600">No names match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">Ticker</th>
                  <th className="px-3 py-2.5 text-right">Price</th>
                  <th className="px-3 py-2.5 text-right">% Chg</th>
                  <th className="px-3 py-2.5 text-right">RVOL</th>
                  <th className="px-3 py-2.5">Setup</th>
                  <th className="px-3 py-2.5">Levels</th>
                  <th className="px-3 py-2.5">Breakout</th>
                  <th className="px-3 py-2.5">Do not chase?</th>
                  <th className="px-3 py-2.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.symbol} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-3">
                      <div className="font-mono text-base font-semibold text-slate-900">{row.symbol}</div>
                      <div className="mt-0.5 max-w-[12rem] truncate text-xs text-slate-500" title={`${row.name} - ${row.theme}`}>
                        {row.name} · {row.theme}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{fmtMoney(row.lastClose)}</td>
                    <td className={`px-3 py-3 text-right font-mono ${Number(row.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtPct(row.changePct)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-mono">{fmtNum(row.relativeVolume)}x</div>
                      <div className="text-[10px] text-slate-500">20D avg {fmtVolume(row.avgVolume20)}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${setupClass(row.setup)}`}>
                        {setupLabel(row.setup)}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs leading-5 text-slate-700">
                      <div>Entry {fmtMoney(row.entryTrigger)}</div>
                      <div>Pullback {fmtMoney(row.pullbackEntry)}</div>
                      <div>Stop {fmtMoney(row.stopLoss)}</div>
                      <div>TP {fmtMoney(row.tp1)} / {fmtMoney(row.tp2)}</div>
                    </td>
                    <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                      <div>5D high: <span className="font-mono text-slate-800">{fmtMoney(row.high5)}</span></div>
                      <div>20D high: <span className="font-mono text-slate-800">{fmtMoney(row.high20)}</span></div>
                      <div>Dist 20D: <span className="font-mono text-slate-800">{fmtPct(row.reasonJson?.distance_to_20d_high_pct)}</span></div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          row.doNotChase
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        {row.doNotChase ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="max-w-[22rem] text-xs leading-5 text-slate-600">{row.reasonSummary}</div>
                      {row.riskPerShare != null ? (
                        <div className="mt-1 text-[10px] text-slate-500">
                          R {fmtMoney(row.riskPerShare)} · RR {fmtNum(row.rewardRiskTp1, 1)} / {fmtNum(row.rewardRiskTp2, 1)}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
