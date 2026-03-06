"use client";

import { useMemo, useState } from "react";

type BacktestSummary = {
  candidate_rows: number;
  total_trades: number;
  triggered_trades: number;
  not_triggered_trades: number;
  skipped_trades: number;
  skip_reason_counts: {
    triggered: number;
    not_triggered_within_window: number;
    no_day_after_signal: number;
    invalid_signal_entry: number;
  };
  win_rate: number;
  avg_return_pct: number;
  avg_holding_days: number;
  gross_return_pct: number;
  max_drawdown_pct: number | null;
  profit_factor: number;
  exit_reason_counts: {
    stop: number;
    tp1: number;
    time_stop: number;
  };
};

type BacktestTrade = {
  symbol: string;
  signal_date: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  exit_reason: "stop" | "tp1" | "time_stop";
  return_pct: number;
  holding_days: number;
};

type BacktestResponse = {
  ok?: boolean;
  error?: string;
  summary?: BacktestSummary;
  trades?: BacktestTrade[];
  assumptions?: {
    entry_mode?: "trigger" | "next_open" | "next_close" | string;
    max_wait_days?: number;
    [key: string]: unknown;
  };
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function pct(v: number | null | undefined, scale = 1) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(scale)}%`;
}

export default function BacktestClient() {
  const DATASETS = [
    {
      key: "v2_core_momentum__core_800",
      label: "Momentum (v2_core_momentum / core_800)",
      strategy_version: "v2_core_momentum",
      universe_slug: "core_800",
    },
    {
      key: "v1__liquid_2000",
      label: "Legacy Momentum (v1 / liquid_2000)",
      strategy_version: "v1",
      universe_slug: "liquid_2000",
    },
  ] as const;
  const now = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    return isoDate(d);
  });
  const [endDate, setEndDate] = useState(() => isoDate(now));
  const [datasetKey, setDatasetKey] = useState<(typeof DATASETS)[number]["key"]>(
    "v2_core_momentum__core_800"
  );
  const [entryMode, setEntryMode] = useState<"trigger" | "next_open" | "next_close">("trigger");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const selectedDataset = DATASETS.find((d) => d.key === datasetKey) ?? DATASETS[0];

  async function runBacktest() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy_version: selectedDataset.strategy_version,
          universe_slug: selectedDataset.universe_slug,
          start_date: startDate,
          end_date: endDate,
          entry_mode: entryMode,
        }),
      });
      const payload = (await res.json().catch(() => null)) as BacktestResponse | null;
      if (!res.ok || !payload?.ok) {
        setResult(payload ?? { ok: false, error: `HTTP ${res.status}` });
      } else {
        setResult(payload);
      }
    } catch (e: unknown) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary;
  const trades = result?.trades ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
        <div className="mb-3 text-sm text-slate-700">Backtesting v1</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 rounded-lg border border-[#eadfce] bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 rounded-lg border border-[#eadfce] bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500">Dataset</label>
            <select
              value={datasetKey}
              onChange={(e) => setDatasetKey(e.target.value as (typeof DATASETS)[number]["key"])}
              className="mt-1 rounded-lg border border-[#eadfce] bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              {DATASETS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500">Entry mode</label>
            <select
              value={entryMode}
              onChange={(e) => setEntryMode(e.target.value as "trigger" | "next_open" | "next_close")}
              className="mt-1 rounded-lg border border-[#eadfce] bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              <option value="trigger">Breakout trigger</option>
              <option value="next_open">Next-day open</option>
              <option value="next_close">Next-day close</option>
            </select>
          </div>
          <button
            onClick={runBacktest}
            disabled={loading}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Running..." : "Run backtest"}
          </button>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Uses stored BUY signals from daily_scans and simple next-day execution assumptions.
        </div>
      </div>

      {result && !result.ok ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {result.error ?? "Backtest failed"}
        </div>
      ) : null}

      {summary ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Candidate BUY rows</div>
            <div className="mt-1 text-2xl font-semibold">{summary.candidate_rows}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Total trades</div>
            <div className="mt-1 text-2xl font-semibold">{summary.total_trades}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Win rate</div>
            <div className="mt-1 text-2xl font-semibold">{pct(summary.win_rate * 100)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Avg return</div>
            <div className="mt-1 text-2xl font-semibold">{pct(summary.avg_return_pct)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Avg holding days</div>
            <div className="mt-1 text-2xl font-semibold">{summary.avg_holding_days.toFixed(1)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Profit factor</div>
            <div className="mt-1 text-2xl font-semibold">{summary.profit_factor.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Max drawdown</div>
            <div className="mt-1 text-2xl font-semibold">{pct(summary.max_drawdown_pct)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4 md:col-span-3">
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
              <span>
                Entry mode:{" "}
                <b>
                  {result?.assumptions?.entry_mode === "next_open"
                    ? "Next-day open"
                    : result?.assumptions?.entry_mode === "next_close"
                      ? "Next-day close"
                      : "Breakout trigger"}
                </b>
              </span>
              {result?.assumptions?.entry_mode === "trigger" ? (
                <span>Trigger window: <b>{Number(result?.assumptions?.max_wait_days ?? 10)} days</b></span>
              ) : null}
              <span>Triggered: <b>{summary.triggered_trades}</b></span>
              <span>Not triggered: <b>{summary.not_triggered_trades}</b></span>
              <span>Gross return: <b>{pct(summary.gross_return_pct)}</b></span>
              <span>Skipped: <b>{summary.skipped_trades}</b></span>
              <span>Skip no-day-after-signal: <b>{summary.skip_reason_counts?.no_day_after_signal ?? 0}</b></span>
              <span>Skip invalid entry: <b>{summary.skip_reason_counts?.invalid_signal_entry ?? 0}</b></span>
              <span>Not triggered in window: <b>{summary.skip_reason_counts?.not_triggered_within_window ?? 0}</b></span>
              <span>Stop: <b>{summary.exit_reason_counts.stop}</b></span>
              <span>TP1: <b>{summary.exit_reason_counts.tp1}</b></span>
              <span>Time stop: <b>{summary.exit_reason_counts.time_stop}</b></span>
            </div>
          </div>
          {summary.candidate_rows <= 5 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 md:col-span-3">
              Only {summary.candidate_rows} candidate BUY rows found for this strategy/date range.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[#eadfce] bg-[#fffdf8]">
        <div className="border-b border-[#eadfce] px-4 py-3 text-sm font-medium text-slate-700">Trades</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-[#eadfce]">
                <th className="p-3">Symbol</th>
                <th className="p-3">Entry date</th>
                <th className="p-3">Exit date</th>
                <th className="p-3">Entry</th>
                <th className="p-3">Exit</th>
                <th className="p-3">Exit reason</th>
                <th className="p-3">Return %</th>
                <th className="p-3">Holding days</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={8}>
                    Run a backtest to view trades.
                  </td>
                </tr>
              ) : (
                trades.map((t, idx) => (
                  <tr key={`${t.symbol}-${t.entry_date}-${idx}`} className="border-b border-[#f1e8da]">
                    <td className="p-3 font-medium">{t.symbol}</td>
                    <td className="p-3">{t.entry_date}</td>
                    <td className="p-3">{t.exit_date}</td>
                    <td className="p-3">{money(t.entry_price)}</td>
                    <td className="p-3">{money(t.exit_price)}</td>
                    <td className="p-3">{t.exit_reason}</td>
                    <td className={`p-3 font-medium ${t.return_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {pct(t.return_pct)}
                    </td>
                    <td className="p-3">{t.holding_days}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
