"use client";

import { useState } from "react";

type BacktestResponse = {
  ok?: boolean;
  metrics?: {
    trades?: number;
    win_rate?: number;
    avg_win_pct?: number;
    avg_loss_pct?: number;
    expectancy_pct?: number;
    profit_factor?: number;
    avg_hold_days?: number;
    max_drawdown_pct?: number;
  };
  [key: string]: unknown;
};

export default function BacktestClient() {
  const [loading, setLoading] = useState(false);
  const [strategyVersion, setStrategyVersion] = useState("v2_core_momentum");
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [raw, setRaw] = useState<string>("");

  async function runBacktest() {
    setLoading(true);
    setResult(null);
    setRaw("");
    try {
      const today = new Date();
      const end = today.toISOString().slice(0, 10);
      const startDate = new Date(today);
      startDate.setFullYear(startDate.getFullYear() - 3);
      const start = startDate.toISOString().slice(0, 10);

      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy_version: strategyVersion,
          universe_slug: "core_800",
          start_date: start,
          end_date: end,
          initial_capital: 100000,
        }),
      });
      const payload = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      setResult(payload);
      setRaw(JSON.stringify(payload, null, 2));
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error ? e.stack ?? null : null;
      const payload = { ok: false, error, detail };
      setResult(payload);
      setRaw(JSON.stringify(payload, null, 2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div className="text-lg font-semibold">8) Backtest</div>
      <div className="text-sm text-slate-700">
        Run a 3-year daily backtest with next-day-open entry and strategy-specific stop/TP/time-stop rules.
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-slate-600">Strategy</label>
        <select
          className="rounded-lg border border-slate-200 bg-white px-2 py-1"
          value={strategyVersion}
          onChange={(e) => setStrategyVersion(e.target.value)}
          disabled={loading}
        >
          <option value="v2_core_momentum">Momentum Swing</option>
          <option value="v1_trend_hold">Trend Hold</option>
        </select>
      </div>
      <button
        className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        onClick={runBacktest}
        disabled={loading}
      >
        {loading ? "Running..." : "Run backtest"}
      </button>
      {result?.ok && result.metrics ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="rounded-xl border border-slate-200 p-2">Trades: {result.metrics.trades ?? 0}</div>
          <div className="rounded-xl border border-slate-200 p-2">
            Win rate: {((result.metrics.win_rate ?? 0) * 100).toFixed(1)}%
          </div>
          <div className="rounded-xl border border-slate-200 p-2">
            Profit factor: {(result.metrics.profit_factor ?? 0).toFixed(2)}
          </div>
          <div className="rounded-xl border border-slate-200 p-2">
            Expectancy: {(result.metrics.expectancy_pct ?? 0).toFixed(2)}%
          </div>
        </div>
      ) : null}
      {raw ? (
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">Raw JSON</summary>
          <pre className="mt-2 overflow-auto text-xs text-slate-700">{raw}</pre>
        </details>
      ) : null}
    </section>
  );
}
