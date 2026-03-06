"use client";

import { useMemo, useState } from "react";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

type BackfillResponse = {
  ok?: boolean;
  strategy_version?: string;
  universe_slug?: string;
  start_date?: string;
  end_date?: string;
  trading_days_processed?: number;
  rows_inserted?: number;
  rows_skipped?: number;
  errors?: Array<{ date: string; error: string }>;
  error?: string;
  detail?: string | null;
};

export default function MomentumBackfillClient() {
  const now = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    return isoDate(d);
  });
  const [endDate, setEndDate] = useState(() => isoDate(now));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BackfillResponse | null>(null);

  async function runBackfill() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/backfill/momentum-history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ start_date: startDate, end_date: endDate }),
      });
      const payload = (await res.json().catch(() => null)) as BackfillResponse | null;
      setResult(payload ?? { ok: false, error: `HTTP ${res.status}` });
    } catch (e: unknown) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div className="text-lg font-semibold">9) Momentum history backfill (admin)</div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">End date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={runBackfill}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? "Running..." : "Run backfill"}
        </button>
      </div>
      {result ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div>Trading days processed: {result.trading_days_processed ?? 0}</div>
          <div>Rows inserted: {result.rows_inserted ?? 0}</div>
          <div>Rows skipped: {result.rows_skipped ?? 0}</div>
          {result.error ? <div className="text-rose-700">Error: {result.error}</div> : null}
          {Array.isArray(result.errors) && result.errors.length > 0 ? (
            <div className="mt-2 text-xs text-slate-600">
              Errors: {result.errors.length} (first: {result.errors[0]?.date} - {result.errors[0]?.error})
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

