import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import PortfolioClient from "./portfolioClient";
import PositionsClient from "./PositionsClient";

type Portfolio = {
  id: string;
  name: string;
  account_currency: string;
  account_size: number;
  risk_per_trade: number;
  max_positions: number;
  is_default: boolean;
  created_at: string;
};

type OpenPosition = {
  id: string;
  symbol: string;
  entry_date: string | null;
  entry_price: number | null;
  shares: number | null;
  stop: number | null;
  status: "OPEN";
};

type ClosedPosition = {
  id: string;
  symbol: string;
  entry_date: string | null;
  entry_price: number | null;
  shares: number | null;
  stop: number | null;
  status: "CLOSED";
  closed_at: string | null;
  exit_price: number | null;
};

function money(value: number, currency = "USD") {
  if (!Number.isFinite(value)) return "-";
  return `${currency} ${value.toFixed(2)}`;
}

export default async function PortfolioPage() {
  const supabase = await supabaseServer();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;

  if (!user) {
    redirect("/auth?next=/portfolio");
  }

  // Default portfolio
  const { data: defaultPortfolio } = await supabase
    .from("portfolios")
    .select(
      "id, name, account_currency, account_size, risk_per_trade, max_positions, is_default, created_at"
    )
    .eq("user_id", user.id)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();

  // All portfolios
  const { data: portfoliosRaw } = await supabase
    .from("portfolios")
    .select(
      "id, name, account_currency, account_size, risk_per_trade, max_positions, is_default, created_at"
    )
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  const portfolios: Portfolio[] = (portfoliosRaw ?? []) as any;

  const currency = defaultPortfolio?.account_currency ?? "USD";
  const accountSize = Number(defaultPortfolio?.account_size ?? 0);
  const maxPositions = Number(defaultPortfolio?.max_positions ?? 5);

  let openPositions: OpenPosition[] = [];
  let closedPositions: ClosedPosition[] = [];

  if (defaultPortfolio?.id) {
    const { data: openRaw } = await supabase
      .from("portfolio_positions")
      .select("id, symbol, entry_date, entry_price, shares, stop, status")
      .eq("user_id", user.id)
      .eq("portfolio_id", defaultPortfolio.id)
      .eq("status", "OPEN")
      .order("created_at", { ascending: false });

    openPositions = (openRaw ?? []) as any;

    const { data: closedRaw } = await supabase
      .from("portfolio_positions")
      .select("id, symbol, entry_date, entry_price, shares, stop, status, closed_at, exit_price")
      .eq("user_id", user.id)
      .eq("portfolio_id", defaultPortfolio.id)
      .eq("status", "CLOSED")
      .order("closed_at", { ascending: false });

    closedPositions = (closedRaw ?? []) as any;
  }

  // Open stats
  const openCount = openPositions.length;

  const totalPositionValue = openPositions.reduce((sum, p) => {
    const entry = Number(p.entry_price);
    const shares = Number(p.shares);
    if (!Number.isFinite(entry) || !Number.isFinite(shares)) return sum;
    return sum + entry * shares;
  }, 0);

  const totalRisk = openPositions.reduce((sum, p) => {
    const entry = Number(p.entry_price);
    const stop = Number(p.stop);
    const shares = Number(p.shares);
    if (![entry, stop, shares].every(Number.isFinite)) return sum;
    return sum + Math.max((entry - stop) * shares, 0);
  }, 0);

  const slotsLeft = Math.max(maxPositions - openCount, 0);
  const pctDeployed = accountSize > 0 ? (totalPositionValue / accountSize) * 100 : 0;

  // Closed stats (realized)
  const closedCount = closedPositions.length;

  const realizedPnl = closedPositions.reduce((sum, p) => {
    const entry = Number(p.entry_price);
    const exit = Number(p.exit_price);
    const shares = Number(p.shares);
    if (![entry, exit, shares].every(Number.isFinite)) return sum;
    return sum + (exit - entry) * shares;
  }, 0);

  const closedCapital = closedPositions.reduce((sum, p) => {
    const entry = Number(p.entry_price);
    const shares = Number(p.shares);
    if (![entry, shares].every(Number.isFinite)) return sum;
    return sum + entry * shares;
  }, 0);

  const realizedPct = closedCapital > 0 ? (realizedPnl / closedCapital) * 100 : 0;

  const wins = closedPositions.reduce((count, p) => {
    const entry = Number(p.entry_price);
    const exit = Number(p.exit_price);
    const shares = Number(p.shares);
    if (![entry, exit, shares].every(Number.isFinite)) return count;
    return (exit - entry) * shares > 0 ? count + 1 : count;
  }, 0);

  const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 0;

  return (
    <div className="container-page space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
          <div className="mt-2 text-sm muted">
            Your holdings dashboard. Positions are tied to the active (default) portfolio.
          </div>
        </div>

        <div>
          <a href="/screener">
            <Button variant="secondary">Back to Screener</Button>
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Positions"
            subtitle={defaultPortfolio ? `Active: ${defaultPortfolio.name}` : "No default portfolio found"}
            right={
              <div className="flex items-center gap-2">
                <Badge variant="neutral">OPEN {openCount}</Badge>
                <Badge variant="neutral">CLOSED {closedCount}</Badge>
                <Badge variant={slotsLeft > 0 ? "watch" : "avoid"}>
                  Slots left {slotsLeft}/{maxPositions}
                </Badge>
              </div>
            }
          />
          <CardContent>
            {defaultPortfolio ? (
              <PositionsClient
                currency={currency}
                accountSize={accountSize}
                openPositions={openPositions}
                closedPositions={closedPositions}
              />
            ) : (
              <div className="text-sm muted">Create a portfolio below and set it as default.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Portfolio stats" subtitle="Open exposure + realized results" />
          <CardContent>
            {defaultPortfolio ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="muted">Portfolio</div>
                  <div className="font-semibold">{defaultPortfolio.name}</div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="muted">Account size</div>
                  <div className="font-mono font-semibold">
                    {currency} {accountSize.toFixed(0)}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200" />

                <div className="text-xs uppercase tracking-wide muted">Open positions</div>

                <div className="flex items-center justify-between">
                  <div className="muted">Capital deployed</div>
                  <div className="font-mono font-semibold">
                    {currency} {totalPositionValue.toFixed(2)}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="muted">% deployed</div>
                  <div className="font-mono font-semibold">{pctDeployed.toFixed(1)}%</div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="muted">Risk deployed</div>
                  <div className="font-mono font-semibold">
                    {currency} {totalRisk.toFixed(2)}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200" />

                <div className="text-xs uppercase tracking-wide muted">Closed trades</div>

                <div className="flex items-center justify-between">
                  <div className="muted">Realized P/L</div>
                  <div className="font-mono font-semibold">{money(realizedPnl, currency)}</div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="muted">Realized return</div>
                  <div className="font-mono font-semibold">
                    {closedCapital > 0 ? `${realizedPct.toFixed(1)}%` : "-"}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="muted">Win rate</div>
                  <div className="font-mono font-semibold">
                    {closedCount > 0 ? `${winRate.toFixed(0)}%` : "-"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm muted">No default portfolio set yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader title="Manage portfolios" subtitle="Create multiple investment journeys and choose a default" />
        <CardContent>
          <PortfolioClient initialPortfolios={portfolios} />
        </CardContent>
      </Card>
    </div>
  );
}