"use client";

import { useEffect, useState } from "react";

type Snapshot = {
  ok: boolean;
  lctd: string | null;
  lctd_source: string;
  latest_scan_date: string | null;
  latest_replay_run_date: string | null;
  latest_breadth_computation_date: string | null;
  latest_sector_ranking_computation_date: string | null;
  runs: Record<string, { updated_at?: string | null; value?: any } | null>;
  scans: Record<string, any>;
  error?: string;
};

function fmt(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export default function ObservabilityPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/observability", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as Snapshot;
        if (!mounted) return;
        setData(json);
      } catch {
        if (!mounted) return;
        setData({ ok: false, lctd: null, lctd_source: "none", latest_scan_date: null, latest_replay_run_date: null, latest_breadth_computation_date: null, latest_sector_ranking_computation_date: null, runs: {}, scans: {}, error: "Failed loading observability" });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return <div className="text-sm text-slate-600">Loading observability…</div>;
  }
  if (!data?.ok) {
    return <div className="text-sm text-rose-700">Observability unavailable: {fmt(data?.error)}</div>;
  }

  const runs = data.runs ?? {};
  const scans = data.scans ?? {};

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[#e8dcc8] bg-[#fffdf8] p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Latest Scan</div>
          <div className="font-semibold text-slate-900">{fmt(data.latest_scan_date)}</div>
        </div>
        <div className="rounded-xl border border-[#e8dcc8] bg-[#fffdf8] p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Latest Replay</div>
          <div className="font-semibold text-slate-900">{fmt(data.latest_replay_run_date)}</div>
        </div>
        <div className="rounded-xl border border-[#e8dcc8] bg-[#fffdf8] p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Latest Breadth</div>
          <div className="font-semibold text-slate-900">{fmt(data.latest_breadth_computation_date)}</div>
        </div>
        <div className="rounded-xl border border-[#e8dcc8] bg-[#fffdf8] p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Latest Sector Ranking</div>
          <div className="font-semibold text-slate-900">{fmt(data.latest_sector_ranking_computation_date)}</div>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {Object.entries(scans).map(([name, s]) => (
          <div key={name} className="rounded-xl border border-[#e8dcc8] bg-[#fffdf8] p-3 text-xs text-slate-700">
            <div className="mb-1 text-sm font-semibold text-slate-900">{name}</div>
            <div>Date: {fmt(s?.latest_date)}</div>
            <div>Universe: {fmt(s?.universe_slug)}</div>
            <div>Strategy: {fmt(s?.strategy_version)}</div>
            <div>Rows: {fmt(s?.total)}</div>
            <div>BUY/WATCH/AVOID: {fmt(s?.buy)}/{fmt(s?.watch)}/{fmt(s?.avoid)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {Object.entries(runs).map(([name, run]) => (
          <div key={name} className="rounded-xl border border-[#e8dcc8] bg-[#fffdf8] p-3 text-xs text-slate-700">
            <div className="mb-1 text-sm font-semibold text-slate-900">{name}</div>
            <div>Updated: {fmt(run?.updated_at)}</div>
            <div>Status: {run?.value?.ok === true ? "ok" : run?.value?.ok === false ? "fail" : "unknown"}</div>
            <div>Strategy: {fmt(run?.value?.strategy_version)}</div>
            <div>Universe: {fmt(run?.value?.universe_slug)}</div>
            <div>Rows written: {fmt(run?.value?.rows_written ?? run?.value?.upserted ?? run?.value?.persisted_rows)}</div>
            <div>Rows skipped/dedupe: {fmt(run?.value?.rows_skipped_dedupe)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
