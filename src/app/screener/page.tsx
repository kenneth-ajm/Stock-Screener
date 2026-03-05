import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import ScreenerPanelClient from "./ScreenerPanelClient";
import UtilitiesClient from "./UtilitiesClient";
import ScreenerSearchClient from "./ScreenerSearchClient";
import CashBalanceEditor from "./CashBalanceEditor";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getLCTD } from "@/lib/scan_status";

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

  const { data: activePortfolio } = await supabase
    .from("portfolios")
    .select("id, name, account_currency, account_size, risk_per_trade, max_positions,cash_balance,cash_updated_at,active,is_default")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  let defaultPortfolio = activePortfolio;
  if (!defaultPortfolio) {
    const fallback = await supabase
      .from("portfolios")
      .select("id, name, account_currency, account_size, risk_per_trade, max_positions,cash_balance,cash_updated_at,active,is_default")
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    defaultPortfolio = fallback.data ?? null;
  }

  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("date, state, close, sma200")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  const regime = regimeRows?.[0] ?? null;
  const lctd = await getLCTD(supabase as any);
  const lctdDate = lctd.lctd ?? null;
  const regimeDate = regime?.date ? String(regime.date) : null;
  const regimeIsStale = !lctdDate || !regimeDate || regimeDate < lctdDate;

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
            subtitle={`Universe: Core 800 (${strategyLabel(activeStrategy)})`}
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
            <ScreenerPanelClient strategyVersion={activeStrategy} universeSlug={DEFAULT_UNIVERSE} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Active portfolio" subtitle="Sizing uses the active portfolio" />
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

                <CashBalanceEditor
                  initialCashBalance={
                    typeof defaultPortfolio.cash_balance === "number"
                      ? defaultPortfolio.cash_balance
                      : null
                  }
                />

                <div className="mt-5 border-t border-slate-200 pt-4 space-y-2">
                  <div className="text-sm font-semibold">Market regime (SPY) — as of LCTD</div>
                  {regime ? (
                    <div className="text-sm">
                      <div className="muted">
                        LCTD: <span className="font-mono">{lctdDate ?? "—"}</span>
                        {" • "}
                        Regime date: <span className="font-mono">{regimeDate}</span>
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
              <div className="text-sm muted">No active portfolio found.</div>
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
