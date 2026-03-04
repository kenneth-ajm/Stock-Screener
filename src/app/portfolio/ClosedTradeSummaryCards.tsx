"use client";

import { ClosedTradeSummary, formatPct, formatUsd } from "@/lib/analytics/closedTradeSummary";

function StatCard({
  label,
  value,
  subValue,
}: {
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {subValue ? <div className="mt-1 text-xs text-slate-500">{subValue}</div> : null}
    </div>
  );
}

export default function ClosedTradeSummaryCards({ summary }: { summary: ClosedTradeSummary }) {
  const trades = summary.trades;

  const pf =
    summary.profitFactor === null
      ? "—"
      : summary.profitFactor === Infinity
        ? "∞"
        : summary.profitFactor.toFixed(2);

  const winRate = `${(summary.winRate * 100).toFixed(0)}%`;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Closed Summary</div>
          <div className="text-xs text-slate-500">
            Based on closed positions with valid entry and exit prices.
          </div>
        </div>
        <div className="text-xs text-slate-500">{trades} trades</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Win rate" value={winRate} subValue={`${summary.wins}W / ${summary.losses}L`} />
        <StatCard label="Avg win" value={formatPct(summary.avgWinPct)} subValue={formatUsd(summary.avgWinUsd)} />
        <StatCard label="Avg loss" value={formatPct(summary.avgLossPct)} subValue={formatUsd(summary.avgLossUsd)} />
        <StatCard
          label="Profit factor"
          value={pf}
          subValue={`Net GP ${formatUsd(summary.grossProfit)} / Net GL $${summary.grossLossAbs.toFixed(2)}`}
        />
        <StatCard label="Expectancy" value={formatUsd(summary.expectancyUsd)} subValue="Avg $ per trade" />
      </div>
    </div>
  );
}
