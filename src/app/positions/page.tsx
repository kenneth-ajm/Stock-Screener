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
          <h1 className="text-3xl font-semibold tracking-tight">Positions</h1>
          <p className="text-sm text-slate-600">Grouped-first open positions workspace with lot-level controls preserved.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Account size</div>
            <div className="mt-1 text-xl font-semibold">{money(snapshot?.account_size ?? null)}</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Deployed (cost basis)</div>
            <div className="mt-1 text-xl font-semibold">{money(snapshot?.deployed_cost_basis ?? null)}</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Market value</div>
            <div className="mt-1 text-xl font-semibold">{money(snapshot?.market_value_optional ?? null)}</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Cash available</div>
            <div className="mt-1 text-xl font-semibold">
              {money(snapshot?.cash_available ?? null)}{" "}
              <span className="text-sm text-slate-500">({snapshot?.cash_source === "manual" ? "Exact" : "Estimated"})</span>
            </div>
          </div>
        </div>

        <PositionsClient
          openPositions={open as any}
          closedPositions={closed as any}
          closedSummary={closedSummary}
          latestPriceBySymbol={latestPriceBySymbol}
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
