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

type Position = {
  id: string;
  symbol: string;
  entry_date: string | null;
  entry_price: number | null;
  shares: number | null;
  stop: number | null;
  status: "OPEN" | "CLOSED";
};

export default async function PortfolioPage() {
  const supabase = await supabaseServer();

  // ✅ Route guard
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

  // Open positions
  let positions: Position[] = [];
  if (defaultPortfolio?.id) {
    const { data: posRaw } = await supabase
      .from("portfolio_positions")
      .select("id, symbol, entry_date, entry_price, shares, stop, status")
      .eq("user_id", user.id)
      .eq("portfolio_id", defaultPortfolio.id)
      .eq("status", "OPEN")
      .order("created_at", { ascending: false });

    positions = (posRaw ?? []) as any;
  }

  const currency = defaultPortfolio?.account_currency ?? "USD";
  const accountSize = Number(defaultPortfolio?.account_size ?? 0);
  const maxPositions = Number(defaultPortfolio?.max_positions ?? 5);

  const openCount = positions.length;

  const totalPositionValue = positions.reduce((sum, p) => {
    const entry = Number(p.entry_price);
    const shares = Number(p.shares);
    if (!Number.isFinite(entry) || !Number.isFinite(shares)) return sum;
    return sum + entry * shares;
  }, 0);

  const totalRisk = positions.reduce((sum, p) => {
    const entry = Number(p.entry_price);
    const stop = Number(p.stop);
    const shares = Number(p.shares);
    if (![entry, stop, shares].every(Number.isFinite)) return sum;
    return sum + Math.max((entry - stop) * shares, 0);
  }, 0);

  const slotsLeft = Math.max(maxPositions - openCount, 0);
  const pctDeployed =
    accountSize > 0 ? (totalPositionValue / accountSize) * 100 : 0;

  return (
    <div className="container-page space-y-6">
      {/* Header with button */}
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
            title="Open positions"
            subtitle={
              defaultPortfolio
                ? `Active: ${defaultPortfolio.name}`
                : "No default portfolio found"
            }
            right={
              <div className="flex items-center gap-2">
                <Badge variant="neutral">OPEN {openCount}</Badge>
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
                positions={positions}
              />
            ) : (
              <div className="text-sm muted">
                Create a portfolio below and set it as default.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Portfolio stats" subtitle="Based on open positions" />
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

                <div className="flex items-center justify-between">
                  <div className="muted">Capital deployed</div>
                  <div className="font-mono font-semibold">
                    {currency} {totalPositionValue.toFixed(2)}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="muted">% deployed</div>
                  <div className="font-mono font-semibold">
                    {pctDeployed.toFixed(1)}%
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="muted">Risk deployed</div>
                  <div className="font-mono font-semibold">
                    {currency} {totalRisk.toFixed(2)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm muted">
                No default portfolio set yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Manage portfolios"
          subtitle="Create multiple investment journeys and choose a default"
        />
        <CardContent>
          <PortfolioClient initialPortfolios={portfolios} />
        </CardContent>
      </Card>
    </div>
  );
}