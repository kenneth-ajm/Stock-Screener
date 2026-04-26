import AppShell from "@/components/app-shell";
import PositionsClient from "@/app/portfolio/PositionsClient";
import { computeClosedTradeSummary } from "@/lib/analytics/closedTradeSummary";
import { getWorkspaceContext } from "@/lib/workspace_context";
import { getPortfolioSnapshot } from "@/lib/portfolio_snapshot";

export const dynamic = "force-dynamic";

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

export default async function PositionsPage() {
  const { supabase, user, portfolios, defaultPortfolio } = await getWorkspaceContext("/positions");
  const portfolioId = String(defaultPortfolio?.id ?? "");
  const snapshot = portfolioId ? await getPortfolioSnapshot(supabase as any, portfolioId, true) : null;

  const { data: openPositions } =
    portfolioId
      ? await supabase
          .from("portfolio_positions")
          .select("*")
          .eq("portfolio_id", portfolioId)
          .eq("status", "OPEN")
          .order("created_at", { ascending: false })
      : ({ data: [] } as any);
  const { data: closedPositions } =
    portfolioId
      ? await supabase
          .from("portfolio_positions")
          .select("*")
          .eq("portfolio_id", portfolioId)
          .eq("status", "CLOSED")
          .order("closed_at", { ascending: false })
      : ({ data: [] } as any);

  const open = openPositions ?? [];
  const closed = closedPositions ?? [];
  const symbols = Array.from(
    new Set(open.map((p: any) => String(p.symbol ?? "").trim().toUpperCase()).filter(Boolean))
  );
  const strategyVersions = Array.from(
    new Set(open.map((p: any) => String(p.strategy_version ?? "v2_core_momentum")).filter(Boolean))
  );
  const latestPriceBySymbol: Record<string, number | null> = {};
  if (symbols.length > 0) {
    const { data: bars } = await supabase
      .from("price_bars")
      .select("symbol,date,close")
      .in("symbol", symbols)
      .order("symbol", { ascending: true })
      .order("date", { ascending: false });
    for (const bar of bars ?? []) {
      const sym = String((bar as any).symbol ?? "").trim().toUpperCase();
      if (!sym || latestPriceBySymbol[sym] != null) continue;
      latestPriceBySymbol[sym] = Number((bar as any).close ?? 0);
    }
  }

  const scanContextByKey: Record<string, { date: string; signal: string; reason_summary: string | null }> = {};
  if (symbols.length > 0 && strategyVersions.length > 0) {
    const { data: contexts } = await supabase
      .from("daily_scans")
      .select("symbol,strategy_version,date,signal,reason_summary")
      .in("symbol", symbols)
      .in("strategy_version", strategyVersions)
      .order("date", { ascending: false })
      .limit(5000);
    for (const row of contexts ?? []) {
      const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
      const strategy = String((row as any)?.strategy_version ?? "").trim();
      const key = `${strategy}::${symbol}`;
      if (!symbol || !strategy || scanContextByKey[key]) continue;
      scanContextByKey[key] = {
        date: String((row as any)?.date ?? ""),
        signal: String((row as any)?.signal ?? ""),
        reason_summary: (row as any)?.reason_summary ? String((row as any).reason_summary) : null,
      };
    }
  }

  const closedSummary = computeClosedTradeSummary(
    closed.map((p: any) => ({
      symbol: p.symbol,
      entry_price: p.entry_price,
      exit_price: p.exit_price,
      entry_fee: p.entry_fee ?? null,
      exit_fee: p.exit_fee ?? null,
      shares: p.shares ?? null,
      quantity: p.quantity ?? null,
      position_size: p.position_size ?? null,
      closed_at: p.closed_at,
    }))
  );

  return (
    <AppShell currentPath="/positions" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Positions</h1>
          <p className="text-sm text-slate-600">Grouped-first open positions workspace with lot-level controls preserved.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="surface-panel p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Open positions</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{open.length}</div>
          </div>
          <div className="surface-panel p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Deployed</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{money(snapshot?.deployed_cost_basis ?? null)}</div>
            <div className="text-xs text-slate-500">Cost basis</div>
          </div>
          <div className="surface-panel p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Market value</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{money(snapshot?.market_value_optional ?? null)}</div>
          </div>
        </div>

        <PositionsClient
          openPositions={open as any}
          closedPositions={closed as any}
          closedSummary={closedSummary}
          latestPriceBySymbol={latestPriceBySymbol}
          scanContextByKey={scanContextByKey}
          defaultFeePerOrder={
            typeof defaultPortfolio?.default_fee_per_order === "number"
              ? defaultPortfolio.default_fee_per_order
              : null
          }
        />
      </div>
    </AppShell>
  );
}
