import { supabaseServer } from "@/lib/supabase/server";
import ScanTableClient from "./scanTableClient";
import UtilitiesClient from "./UtilitiesClient";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export default async function ScreenerPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  // Default portfolio (active journey)
  const { data: defaultPortfolio } = await supabase
    .from("portfolios")
    .select("id, name, account_currency, account_size, risk_per_trade, max_positions")
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();

  // Latest regime
  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("date, state, close, sma200")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  const regime = regimeRows?.[0] ?? null;

  // Latest scan date for core_400 v1
  const { data: latestScan } = await supabase
    .from("daily_scans")
    .select("date")
    .eq("universe_slug", "core_400")
    .eq("strategy_version", "v1")
    .order("date", { ascending: false })
    .limit(1);

  const latestScanDate = latestScan?.[0]?.date ?? null;

  // Scan rows (compact fields; Why loaded on-demand from /api/why)
  let scanRows: any[] = [];
  if (latestScanDate) {
    const { data: rows } = await supabase
      .from("daily_scans")
      .select("symbol, signal, confidence, entry, stop, tp1, tp2")
      .eq("universe_slug", "core_400")
      .eq("strategy_version", "v1")
      .eq("date", latestScanDate)
      .order("confidence", { ascending: false })
      .limit(80);

    scanRows = rows ?? [];
  }

  const regimeBadge =
    regime?.state === "FAVORABLE" ? (
      <Badge variant="buy">FAVORABLE</Badge>
    ) : regime?.state === "DEFENSIVE" ? (
      <Badge variant="avoid">DEFENSIVE</Badge>
    ) : (
      <Badge variant="watch">CAUTION</Badge>
    );

  return (
    <div className="container-page space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Screener</h1>
          <div className="mt-2 text-sm muted">
            Logged in as <span className="font-semibold">{data.user?.email}</span>
          </div>
        </div>

        <div className="flex gap-3">
          <a href="/portfolio">
            <Button variant="secondary">Portfolios</Button>
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Latest scan"
            subtitle={
              latestScanDate
                ? `Scan date: ${latestScanDate} • Universe: core_400`
                : "Run a scan to populate results"
            }
            right={regime ? regimeBadge : <Badge variant="neutral">No regime</Badge>}
          />
          <CardContent>
            {!latestScanDate ? (
              <div className="text-sm muted">
                No scan results yet. Use Utilities below to ingest and scan.
              </div>
            ) : (
              <ScanTableClient rows={scanRows} scanDate={latestScanDate} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Active portfolio" subtitle="Sizing uses the default portfolio" />
          <CardContent>
            {defaultPortfolio ? (
              <div className="space-y-2 text-sm">
                <div className="text-base font-semibold">{defaultPortfolio.name}</div>
                <div className="muted">
                  <span className="font-mono">
                    {defaultPortfolio.account_currency}{" "}
                    {Number(defaultPortfolio.account_size).toFixed(0)}
                  </span>
                </div>
                <div className="muted">
                  Risk/trade: <span className="font-semibold">{defaultPortfolio.risk_per_trade}</span>
                  {" • "}
                  Max positions: <span className="font-semibold">{defaultPortfolio.max_positions}</span>
                </div>
                <a className="underline text-sm muted" href="/portfolio">
                  Manage portfolios
                </a>
              </div>
            ) : (
              <div className="text-sm muted">No default portfolio found.</div>
            )}

            <div className="mt-5 border-t border-slate-200 pt-4 space-y-2">
              <div className="text-sm font-semibold">Market regime (SPY)</div>
              {regime ? (
                <div className="text-sm">
                  <div className="muted">
                    Date: <span className="font-mono">{regime.date}</span>
                  </div>
                  <div className="mt-1">
                    State: <span className="font-semibold">{regime.state}</span>
                  </div>
                  <div className="mt-1 muted font-mono">
                    Close {Number(regime.close).toFixed(2)} • SMA200{" "}
                    {Number(regime.sma200).toFixed(2)}
                  </div>
                </div>
              ) : (
                <div className="text-sm muted">No regime computed yet.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader title="Utilities" subtitle="Run server jobs without leaving the page" />
        <CardContent>
          <UtilitiesClient />
        </CardContent>
      </Card>
    </div>
  );
}