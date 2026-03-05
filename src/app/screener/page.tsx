import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import ScanTableClient from "./scanTableClient";
import UtilitiesClient from "./UtilitiesClient";
import ScreenerSearchClient from "./ScreenerSearchClient";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { getFreshnessStatus, getLCTD } from "@/lib/scan_status";
import { runDiagnosticsWithClient } from "@/lib/diagnostics";
import { getActivePortfolioCapacity } from "@/lib/portfolio_capacity";
import { computePortfolioAwareAction } from "@/lib/execution_action";

export const dynamic = "force-dynamic";

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY_VERSION = "v2_core_momentum";
const TREND_STRATEGY_VERSION = "v1_trend_hold";
const DISPLAY_BUY_CAP = 5;
const DISPLAY_WATCH_CAP = 10;

type ScanRow = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  rank_score?: number | null;
  rank?: number | null;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  reason_json?: unknown;
  portfolio_action?: "BUY_NOW" | "WAIT" | "SKIP";
  action_reason?: string;
  sizing?: {
    shares: number;
    est_cost: number;
    risk_per_share: number;
    risk_budget: number;
  };
};

function rankRows(rows: ScanRow[]) {
  return [...rows].sort((a, b) => {
    const ars = typeof a.rank_score === "number" && Number.isFinite(a.rank_score) ? a.rank_score : null;
    const brs = typeof b.rank_score === "number" && Number.isFinite(b.rank_score) ? b.rank_score : null;
    if (ars !== null && brs !== null && brs !== ars) return brs - ars;
    if (ars !== null && brs === null) return -1;
    if (ars === null && brs !== null) return 1;
    const ac = Number(a.confidence ?? 0);
    const bc = Number(b.confidence ?? 0);
    if (bc !== ac) return bc - ac;
    return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
  });
}

function applyDisplayCaps(rows: ScanRow[]) {
  const buyRanked = rankRows(rows.filter((r) => r.signal === "BUY"));
  const watchRanked = rankRows(rows.filter((r) => r.signal === "WATCH"));

  const buysHaveRank = buyRanked.some((r) => typeof r.rank === "number" && Number.isFinite(r.rank));
  const watchHaveRank = watchRanked.some((r) => typeof r.rank === "number" && Number.isFinite(r.rank));

  const buys = buysHaveRank
    ? (() => {
        const byRank = buyRanked.filter(
          (r) => typeof r.rank === "number" && Number.isFinite(r.rank) && Number(r.rank) <= DISPLAY_BUY_CAP
        );
        return byRank.length > 0 ? byRank : buyRanked.slice(0, DISPLAY_BUY_CAP);
      })()
    : buyRanked.slice(0, DISPLAY_BUY_CAP);

  const watches = watchHaveRank
    ? (() => {
        const byRank = watchRanked.filter(
          (r) => typeof r.rank === "number" && Number.isFinite(r.rank) && Number(r.rank) <= DISPLAY_WATCH_CAP
        );
        return byRank.length > 0 ? byRank : watchRanked.slice(0, DISPLAY_WATCH_CAP);
      })()
    : watchRanked.slice(0, DISPLAY_WATCH_CAP);

  return rankRows([...buys, ...watches]);
}

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
  const lctdStatus = await getLCTD(supabase as any);
  const lastCompletedTradingDay = lctdStatus.lctd ?? "";

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
  const freshness = getFreshnessStatus({
    lctd: lastCompletedTradingDay || null,
    latestScanDate: latestScanDate ? String(latestScanDate) : null,
    regimeDate: regime?.date ? String(regime.date) : null,
  });
  const regimeIsStale = freshness.regime_date
    ? freshness.expected_date !== freshness.regime_date
    : true;
  const diagnostics = await runDiagnosticsWithClient(supabase as any);

  let scanRows: ScanRow[] = [];
  let capacity = null as Awaited<ReturnType<typeof getActivePortfolioCapacity>>;
  let todaysActionable = 0;
  if (latestScanDate) {
    const { data: rows } = await supabase
      .from("daily_scans")
      .select("symbol, signal, confidence, rank_score, rank, entry, stop, tp1, tp2, reason_json")
      .eq("universe_slug", DEFAULT_UNIVERSE)
      .eq("strategy_version", activeStrategy)
      .eq("date", latestScanDate)
      .order("confidence", { ascending: false })
      .order("symbol", { ascending: true })
      .limit(200);

    scanRows = applyDisplayCaps((rows ?? []) as ScanRow[]);

    capacity = await getActivePortfolioCapacity({
      supabase: supabase as any,
      userId: user.id,
    });
    scanRows = scanRows.map((row) => {
      const action = computePortfolioAwareAction(
        {
          signal: row.signal,
          entry: Number(row.entry),
          stop: Number(row.stop),
          confidence: Number(row.confidence),
          rank_score: typeof row.rank_score === "number" ? row.rank_score : null,
        },
        capacity
      );
      return {
        ...row,
        portfolio_action: action.action,
        action_reason: action.action_reason,
        sizing: action.sizing,
      };
    });

    const buyNowSorted = [...scanRows]
      .filter((r) => r.portfolio_action === "BUY_NOW")
      .sort((a, b) => {
        const ar = typeof a.rank_score === "number" ? a.rank_score : Number(a.confidence ?? 0);
        const br = typeof b.rank_score === "number" ? b.rank_score : Number(b.confidence ?? 0);
        if (br !== ar) return br - ar;
        return String(a.symbol).localeCompare(String(b.symbol));
      });
    const keepBuyNow = new Set(buyNowSorted.slice(0, 3).map((r) => r.symbol));
    scanRows = scanRows.map((row) => {
      if (row.portfolio_action === "BUY_NOW" && !keepBuyNow.has(row.symbol)) {
        return { ...row, portfolio_action: "WAIT", action_reason: "Prioritize top 3 actionable today" };
      }
      return row;
    });
    todaysActionable = scanRows.filter((r) => r.portfolio_action === "BUY_NOW").length;
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
            {!diagnostics.ok ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                Diagnostics failing: scan state may be unreliable
              </div>
            ) : null}
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
            {capacity ? (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Today&apos;s Plan • Slots left: <span className="font-semibold">{capacity.slots_left}</span>
                {" • "}
                Cash available: <span className="font-semibold">{Number(capacity.cash_available).toFixed(2)}</span>
                {" • "}
                Actionable today: <span className="font-semibold">{todaysActionable}</span>
              </div>
            ) : null}
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
