"use client";

import { useEffect, useState } from "react";
import ScanTableClient from "./scanTableClient";
import { Badge } from "@/components/ui/Badge";

type Row = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  technical_score?: number | null;
  decision_strength?: number | null;
  universe_slug?: string | null;
  source_scan_date?: string | null;
  rank?: number | null;
  rank_score?: number | null;
  quality_score?: number | null;
  risk_grade?: "A" | "B" | "C" | "D" | null;
  quality_signal?: "BUY" | "WATCH" | "AVOID" | null;
  quality_summary?: string | null;
  trade_risk_layer?: {
    prep_state?: "READY" | "REVIEW" | "BLOCKED";
    summary?: string;
  } | null;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  reason_summary?: string | null;
  atr14?: number | null;
  event_risk?: boolean;
  news_risk?: boolean;
  action?: "BUY_NOW" | "WAIT" | "SKIP";
  action_reason?: string;
  sizing?: {
    shares: number;
    est_cost: number;
    risk_per_share: number;
    risk_budget: number;
  };
};

type ScreenerPayload = {
  ok: boolean;
  meta?: {
    date_used: string | null;
    lctd: string | null;
    regime_state: string | null;
    regime_date: string | null;
    regime_stale: boolean;
    rows_raw_count?: number;
    rows_display_count?: number;
    selected_universe_mode?: "auto_union" | "explicit";
    allowed_universes?: string[];
    auto_universe_dates?: Array<{ universe_slug: string; date_used: string | null; rows: number }>;
    universe_availability?: Record<
      string,
      { universe_slug: string; latest_date: string | null; rows: number; has_scans: boolean }
    >;
  };
  capacity?: {
    slots_left: number;
    cash_available: number;
    cash_source: "manual" | "estimated";
    cash_updated_at: string | null;
    risk_per_trade: number;
    deployed_exceeds_account_size?: boolean;
    unknown_open_positions_count?: number;
  } | null;
  rows?: Row[];
  error?: string;
};

export default function ScreenerPanelClient({
  strategyVersion,
  universeSlug = "",
}: {
  strategyVersion: string;
  universeSlug?: string;
}) {
  const requestKey = `${strategyVersion}:${universeSlug}`;
  const [result, setResult] = useState<{ key: string; data: ScreenerPayload | null }>({
    key: "",
    data: null,
  });
  const data = result.key === requestKey ? result.data : null;
  const loading = result.key !== requestKey;

  useEffect(() => {
    let mounted = true;
    fetch(
      `/api/screener-data?strategy_version=${encodeURIComponent(strategyVersion)}&universe_slug=${encodeURIComponent(universeSlug)}`,
      { cache: "no-store" }
    )
      .then((res) => res.json())
      .then((json) => {
        if (mounted) setResult({ key: requestKey, data: json as ScreenerPayload });
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        const msg = e instanceof Error ? e.message : "Failed to load screener data";
        setResult({ key: requestKey, data: { ok: false, error: msg } });
      });
    return () => {
      mounted = false;
    };
  }, [requestKey, strategyVersion, universeSlug]);

  if (loading) {
    return <div className="text-sm muted">Loading screener data...</div>;
  }
  if (!data?.ok) {
    return <div className="text-sm text-rose-600">Failed to load: {data?.error ?? "Unknown error"}</div>;
  }

  const rows = data.rows ?? [];
  const scanDate = data.meta?.date_used ?? "";
  const lctd = data.meta?.lctd ?? "";
  const regimeDate = data.meta?.regime_date ?? "";
  const regimeState = data.meta?.regime_state ?? null;
  const regimeStale = Boolean(data.meta?.regime_stale);
  const actionable = rows.filter((r) => r.action === "BUY_NOW").length;
  const allowedUniverses = data.meta?.allowed_universes ?? [];
  const availability = data.meta?.universe_availability ?? {};
  const coveredRows = allowedUniverses.reduce(
    (sum, universe) =>
      availability[universe]?.latest_date === scanDate ? sum + Number(availability[universe]?.rows ?? 0) : sum,
    0
  );
  const coverageLabel = allowedUniverses
    .map((universe) => {
      const stats = availability[universe];
      const context = stats?.latest_date === scanDate ? "current" : "not merged into current date";
      return `${universe}: ${Number(stats?.rows ?? 0).toLocaleString()} rows${stats?.latest_date ? ` (${stats.latest_date}, ${context})` : ""}`;
    })
    .join(" • ");

  const regimeBadge =
    regimeState === "FAVORABLE" ? (
      <Badge variant="buy">FAVORABLE</Badge>
    ) : regimeState === "DEFENSIVE" ? (
      <Badge variant="avoid">DEFENSIVE</Badge>
    ) : (
      <Badge variant="watch">CAUTION</Badge>
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          Scan date: <span className="font-mono">{scanDate || "—"}</span>
        </div>
        <div className="flex items-center gap-2">
          {regimeBadge}
          {regimeStale ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
              STALE (run rescan)
            </span>
          ) : null}
        </div>
      </div>
      <div className="text-xs text-slate-500">
        Market regime (SPY) — as of LCTD • LCTD: <span className="font-mono">{lctd || "—"}</span>
        {" • "}Regime date: <span className="font-mono">{regimeDate || "—"}</span>
      </div>

      <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs text-slate-600">
        <div className="font-semibold text-emerald-800">
          {data.meta?.selected_universe_mode === "auto_union" ? "Broad market coverage" : "Explicit universe"}
          {coveredRows > 0 ? ` • ${coveredRows.toLocaleString()} stored scan rows` : ""}
        </div>
        <div className="mt-1">
          {coverageLabel || "No populated scan coverage is available for this strategy yet."}
        </div>
        <div className="mt-1 text-slate-500">
          The table is a ranked daily subset; coverage is not limited to the names currently displayed.
        </div>
      </div>

      {data.capacity ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Today&apos;s Plan • Slots left: <span className="font-semibold">{data.capacity.slots_left}</span>
          {" • "}
          Actionable today: <span className="font-semibold">{actionable}</span>
          {(data.capacity.unknown_open_positions_count ?? 0) > 0 ? (
            <div className="mt-1 text-xs text-amber-700">
              {data.capacity.unknown_open_positions_count} open position(s) missing entry/qty excluded from estimate.
            </div>
          ) : null}
        </div>
      ) : null}

      <ScanTableClient rows={rows as any} scanDate={scanDate} strategyVersion={strategyVersion} lastCompletedTradingDay={lctd} />
    </div>
  );
}
