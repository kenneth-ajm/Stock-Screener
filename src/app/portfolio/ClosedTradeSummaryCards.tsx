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
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
      <div className="text-xs text-white/60">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {subValue ? <div className="mt-1 text-xs text-white/50">{subValue}</div> : null}
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
          <div className="text-sm font-semibold">Closed Summary</div>
          <div className="text-xs text-white/60">
            Based on closed positions with valid entry and exit prices.
          </div>
        </div>
        <div className="text-xs text-white/50">{trades} trades</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Win rate" value={winRate} subValue={`${summary.wins}W / ${summary.losses}L`} />
        <StatCard label="Avg win" value={formatPct(summary.avgWinPct)} subValue={formatUsd(summary.avgWinUsd)} />
        <StatCard label="Avg loss" value={formatPct(summary.avgLossPct)} subValue={formatUsd(summary.avgLossUsd)} />
        <StatCard label="Profit factor" value={pf} subValue={`GP ${formatUsd(summary.grossProfit)} / GL $${summary.grossLossAbs.toFixed(2)}`} />
        <StatCard label="Expectancy" value={formatUsd(summary.expectancyUsd)} subValue="Avg $ per trade" />
      </div>
    </div>
  );
}