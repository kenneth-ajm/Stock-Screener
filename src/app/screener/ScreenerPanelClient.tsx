"use client";

import { useEffect, useState } from "react";
import ScanTableClient from "./scanTableClient";
import { Badge } from "@/components/ui/Badge";

type Row = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
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
  universeSlug = "core_800",
}: {
  strategyVersion: string;
  universeSlug?: string;
}) {
  const [data, setData] = useState<ScreenerPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(
      `/api/screener-data?strategy_version=${encodeURIComponent(strategyVersion)}&universe_slug=${encodeURIComponent(universeSlug)}`,
      { cache: "no-store" }
    )
      .then((res) => res.json())
      .then((json) => {
        if (mounted) setData(json as ScreenerPayload);
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        const msg = e instanceof Error ? e.message : "Failed to load screener data";
        setData({ ok: false, error: msg });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [strategyVersion, universeSlug]);

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

      {data.capacity ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Today&apos;s Plan • Slots left: <span className="font-semibold">{data.capacity.slots_left}</span>
          {" • "}
          Cash available: <span className="font-semibold">{Number(data.capacity.cash_available).toFixed(2)}</span>{" "}
          <span className="text-xs text-slate-500">
            ({data.capacity.cash_source === "manual" ? "Exact" : "Estimated"})
          </span>
          {" • "}
          Actionable today: <span className="font-semibold">{actionable}</span>
          {data.capacity.deployed_exceeds_account_size ? (
            <span className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
              Deployed exceeds account size (check holdings)
            </span>
          ) : null}
          {data.capacity.cash_source === "estimated" ? (
            <div className="mt-1 text-xs text-slate-500">
              Set cash balance to make this accurate.
            </div>
          ) : null}
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
