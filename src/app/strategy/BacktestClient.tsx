"use client";

import { useState } from "react";

export default function BacktestClient() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  async function runBacktest() {
    setLoading(true);
    setResult("");
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
          strategy_version: "v2_core_momentum",
          universe_slug: "core_800",
          start_date: start,
          end_date: end,
          initial_capital: 100000,
        }),
      });
      const payload = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      setResult(JSON.stringify(payload, null, 2));
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error ? e.stack ?? null : null;
      setResult(JSON.stringify({ ok: false, error, detail }, null, 2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div className="text-lg font-semibold">8) Backtest (Scaffolding)</div>
      <div className="text-sm text-slate-700">
        Run a minimal scaffold request to validate endpoint wiring for future backtest development.
      </div>
      <button
        className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        onClick={runBacktest}
        disabled={loading}
      >
        {loading ? "Running..." : "Backtest"}
      </button>
      {result ? (
        <pre className="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          {result}
        </pre>
      ) : null}
    </section>
  );
}

