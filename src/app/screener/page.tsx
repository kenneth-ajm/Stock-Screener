import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import ScanTableClient from "./scanTableClient";
import UtilitiesClient from "./UtilitiesClient";
import ScreenerSearchClient from "./ScreenerSearchClient";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { lastCompletedUsTradingDay } from "@/lib/tradingDay";

export const dynamic = "force-dynamic";

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY_VERSION = "v2_core_momentum";
const TREND_STRATEGY_VERSION = "v1_trend_hold";

function strategyLabel(version: string) {
  return version === TREND_STRATEGY_VERSION ? "Trend Hold" : "Momentum Swing";
}

type AutopilotStatus = {
  ok?: boolean;
  date_used?: string | null;
  bars_upserted?: number;
  scan_written?: number;
  buy_count?: number;
  watch_count?: number;
  duration_ms?: number;
  error?: string | null;
};

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams?: Promise<{ strategy?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const requested = String(params.strategy ?? DEFAULT_STRATEGY_VERSION).trim();
  const activeStrategy =
    requested === TREND_STRATEGY_VERSION ? TREND_STRATEGY_VERSION : DEFAULT_STRATEGY_VERSION;

  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?next=/screener");

  const { data: defaultPortfolio } = await supabase
    .from("portfolios")
    .select("id, name, account_currency, account_size, risk_per_trade, max_positions")
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();

  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("date, state, close, sma200")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  const regime = regimeRows?.[0] ?? null;
  const lastCompletedTradingDay = lastCompletedUsTradingDay();
  const regimeIsStale = !!regime?.date && String(regime.date) < lastCompletedTradingDay;

  let autopilotStatus: { updated_at?: string | null; value?: AutopilotStatus | null } | null = null;
  try {
    const { data: statusRow } = await supabase
      .from("system_status")
      .select("updated_at,value")
      .eq("key", "daily_autopilot_core_800")
      .maybeSingle();
    autopilotStatus = statusRow
      ? {
          updated_at: statusRow.updated_at ?? null,
          value: (statusRow.value ?? null) as AutopilotStatus | null,
        }
      : null;
  } catch {
    autopilotStatus = null;
  }

  // Latest scan date for the core momentum universe
  const { data: latestScan } = await supabase
    .from("daily_scans")
    .select("date")
    .eq("universe_slug", DEFAULT_UNIVERSE)
    .eq("strategy_version", activeStrategy)
    .order("date", { ascending: false })
    .limit(1);

  const latestScanDate = latestScan?.[0]?.date ?? null;

  let scanRows: any[] = [];
  if (latestScanDate) {
    const { data: rows } = await supabase
      .from("daily_scans")
      .select("symbol, signal, confidence, entry, stop, tp1, tp2, reason_json")
      .eq("universe_slug", DEFAULT_UNIVERSE)
      .eq("strategy_version", activeStrategy)
      .eq("date", latestScanDate)
      .order("confidence", { ascending: false })
      .limit(200);

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
    <div className="container-page px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Screener</h1>
          <div className="mt-2 text-sm muted">
            Logged in as <span className="font-semibold break-all">{user.email}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
          <ScreenerSearchClient />
          <a href="/portfolios">
            <Button variant="secondary">Portfolios</Button>
          </a>
          <a href="/strategy">
            <Button variant="secondary">Strategy</Button>
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Latest scan"
            subtitle={
              latestScanDate
                ? `Scan date: ${latestScanDate} • Universe: Core 800 (${strategyLabel(activeStrategy)})`
                : "Run a scan to populate results"
            }
            right={regime ? regimeBadge : <Badge variant="neutral">No regime</Badge>}
          />
          <CardContent>
            <div className="mb-3 flex items-center gap-2">
              <a href="/screener?strategy=v2_core_momentum">
                <button
                  className={`rounded-xl border px-3 py-1.5 text-sm font-medium ${
                    activeStrategy === DEFAULT_STRATEGY_VERSION
                      ? "border-slate-300 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  Momentum Swing
                </button>
              </a>
              <a href="/screener?strategy=v1_trend_hold">
                <button
                  className={`rounded-xl border px-3 py-1.5 text-sm font-medium ${
                    activeStrategy === TREND_STRATEGY_VERSION
                      ? "border-slate-300 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  Trend Hold
                </button>
              </a>
            </div>
            {!latestScanDate ? (
              <div className="text-sm muted">
                No Core 800 scan results yet. Use Utilities below:
                <br />
                1) Ingest history (until you have good coverage)
                <br />
                2) Run scan (all batches) for {strategyLabel(activeStrategy)}
              </div>
            ) : (
              <ScanTableClient
                rows={scanRows}
                scanDate={latestScanDate}
                strategyVersion={activeStrategy}
                lastCompletedTradingDay={lastCompletedTradingDay}
              />
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
                  Risk/trade:{" "}
                  <span className="font-semibold">
                    {(Number(defaultPortfolio.risk_per_trade) * 100).toFixed(1)}%
                  </span>
                  {" • "}
                  Max positions:{" "}
                  <span className="font-semibold">{defaultPortfolio.max_positions}</span>
                </div>

                <div className="flex flex-col gap-1 pt-1">
                  <a className="underline text-sm muted" href="/portfolios">
                    Manage portfolios
                  </a>
                  <a className="underline text-sm muted" href="/strategy">
                    Strategy & logic
                  </a>
                </div>

                <div className="mt-5 border-t border-slate-200 pt-4 space-y-2">
                  <div className="text-sm font-semibold">Market regime (SPY)</div>
                  {regime ? (
                    <div className="text-sm">
                      <div className="muted">
                        Date: <span className="font-mono">{regime.date}</span>
                        {regimeIsStale ? (
                          <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                            STALE (run rescan)
                          </span>
                        ) : null}
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
              </div>
            ) : (
              <div className="text-sm muted">No default portfolio found.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader title="Utilities" subtitle="Autopilot-first workflow with optional manual controls" />
        <CardContent>
          <UtilitiesClient
            universeSlug={DEFAULT_UNIVERSE}
            strategyVersion={activeStrategy}
            strategyLabel={strategyLabel(activeStrategy)}
            autopilotStatus={autopilotStatus}
          />
        </CardContent>
      </Card>
    </div>
  );
}
