"use client";

import { useState } from "react";

type JobKey = "prices" | "regime" | "scan" | null;

async function post(endpoint: string) {
  const res = await fetch(endpoint, { method: "POST" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `Request failed: ${endpoint}`);
  }
}

function ActionButton({
  label,
  description,
  primary,
  loading,
  onClick,
}: {
  label: string;
  description: string;
  primary?: boolean;
  loading?: boolean;
  onClick: () => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <button
        onClick={onClick}
        disabled={!!loading}
        className={[
          "w-full rounded-full px-6 py-3 text-sm font-medium transition whitespace-nowrap",
          primary
            ? "bg-slate-900 text-white hover:bg-slate-800"
            : "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50",
          loading ? "opacity-60" : "",
        ].join(" ")}
      >
        {loading ? "Working…" : label}
      </button>
      <div className="text-xs text-slate-500 leading-snug">{description}</div>
    </div>
  );
}

export default function UtilitiesClient() {
  const [loading, setLoading] = useState<JobKey>(null);

  async function run(key: Exclude<JobKey, null>, endpoint: string) {
    try {
      setLoading(key);
      await post(endpoint);
      alert("Done ✅");
    } catch (e: any) {
      alert(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="space-y-1">
        <div className="text-xl font-semibold text-slate-900">Daily Desk Run (EOD)</div>
        <div className="text-sm text-slate-500">
          Run these in order to refresh today’s screener results.
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <ActionButton
          label="Step 1: Fetch Today’s Prices"
          description="Pulls latest daily bars for SPY + your stock universe from Polygon."
          loading={loading === "prices"}
          onClick={() => run("prices", "/api/ingest-polygon")}
        />

        <ActionButton
          label="Step 2: Update Market Regime (SPY)"
          description="Sets FAVORABLE vs DEFENSIVE using SPY close vs SMA200."
          loading={loading === "regime"}
          onClick={() => run("regime", "/api/regime")}
        />

        <ActionButton
          label="Step 3: Generate Today’s Screener"
          description="Runs the scan and updates BUY / WATCH / AVOID results (daily_scans)."
          loading={loading === "scan"}
          primary
          onClick={() => run("scan", "/api/scan")}
        />
      </div>
    </div>
  );
}