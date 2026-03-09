import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import { getPortfolioSnapshot } from "@/lib/portfolio_snapshot";
import { getLCTD } from "@/lib/scan_status";
import { POST as quotesPost } from "@/app/api/quotes/route";
import { getBuyZone, getEntryStatus } from "@/lib/buy_zone";
import { mapExecutionState } from "@/lib/execution_state";
import { applyEarningsRiskToAction, lookupEarningsRiskForSymbols } from "@/lib/earnings_risk";
import { applyBreadthToAction, computeMarketBreadth } from "@/lib/market_breadth";
import TickerCheckClient from "./TickerCheckClient";
import { allowedUniversesForStrategy, defaultUniverseForStrategy } from "@/lib/strategy_universe";
import { getBuildMarker, getEnvironmentLabel } from "@/lib/build_marker";
import PrivacyMoney from "@/components/privacy-money";
import PrivacyToggle from "./PrivacyToggle";
const DASHBOARD_PAGE_MARKER = "dashboard-canonical-20260308-a";
const BUY_CAP = 5;
const WATCH_CAP = 10;
const MAX_ROWS = 200;

function signalPill(signal: "BUY" | "WATCH" | "AVOID") {
  if (signal === "BUY") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (signal === "WATCH") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function fmtPrice(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function fmtSignedPct(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}

function actionPill(action: "BUY NOW" | "WAIT" | "SKIP") {
  if (action === "BUY NOW") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (action === "WAIT") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function extractAtr14(reasonJson: any): number | null {
  const metrics = reasonJson?.metrics ?? {};
  const keys = ["atr14", "atr_14", "atr"];
  for (const key of keys) {
    const n = Number(metrics?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function rankRows(rows: Array<any>) {
  return [...rows].sort((a, b) => {
    const ar = typeof a.rank_score === "number" ? a.rank_score : Number(a.confidence ?? 0);
    const br = typeof b.rank_score === "number" ? b.rank_score : Number(b.confidence ?? 0);
    if (br !== ar) return br - ar;
    return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
  });
}

function applyDisplayCaps(rows: Array<any>) {
  const buyRanked = rankRows(rows.filter((r) => String(r.signal ?? "").toUpperCase() === "BUY")).slice(0, BUY_CAP);
  const watchRanked = rankRows(rows.filter((r) => String(r.signal ?? "").toUpperCase() === "WATCH")).slice(0, WATCH_CAP);
  const avoidRanked = rankRows(
    rows.filter((r) => {
      const sig = String(r.signal ?? "").toUpperCase();
      return sig !== "BUY" && sig !== "WATCH";
    })
  );
  return rankRows([...buyRanked, ...watchRanked, ...avoidRanked]).slice(0, MAX_ROWS);
}

type QuoteMap = Record<
  string,
  {
    price: number;
    asOf: string;
    source: "snapshot" | "eod_close";
  } | null
>;
const PRICE_MISMATCH_THRESHOLD_PCT = 0.6;

type BrokerSnapshotValue = {
  connection_ok?: boolean;
  configured?: boolean;
  account?: {
    cash_available?: number | null;
    equity?: number | null;
    buying_power?: number | null;
    currency?: string | null;
  } | null;
  positions_count?: number;
  positions?: Array<{
    symbol?: string | null;
    quantity?: number | null;
    avg_cost?: number | null;
    market_value?: number | null;
  }>;
};

export const dynamic = "force-dynamic";

function resolveQty(row: any) {
  const raw = row?.shares ?? row?.quantity ?? row?.position_size ?? row?.qty ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ diag?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const diagRaw = String(params.diag ?? "").trim().toLowerCase();
  const showDiagnostics = diagRaw === "1" || diagRaw === "true";
  const buildMarker = getBuildMarker();
  const envLabel = getEnvironmentLabel();
  const { supabase, user, portfolios, defaultPortfolio } = await getWorkspaceContext("/dashboard");
  const portfolioId = String(defaultPortfolio?.id ?? "");
  const snapshot = portfolioId ? await getPortfolioSnapshot(supabase as any, portfolioId, true) : null;
  const lctd = await getLCTD(supabase as any);

  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("date,state,close,sma200")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);
  const regime = regimeRows?.[0] ?? null;

  async function loadStrategySummary(strategyVersion: string) {
    const allowedUniverses = allowedUniversesForStrategy(strategyVersion);
    const rawRows: Array<any> = [];
    const universeDates: Array<{ universe_slug: string; date_used: string | null; rows: number }> = [];

    for (const universe of allowedUniverses) {
      const { data: latestRow } = await supabase
        .from("daily_scans")
        .select("date")
        .eq("universe_slug", universe)
        .eq("strategy_version", strategyVersion)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const date = latestRow?.date ? String(latestRow.date) : null;
      if (!date) {
        universeDates.push({ universe_slug: universe, date_used: null, rows: 0 });
        continue;
      }
      const { data: rows } = await supabase
        .from("daily_scans")
        .select("symbol,signal,confidence,rank,rank_score,reason_summary,reason_json,entry,stop,tp1,tp2,universe_slug,date")
        .eq("universe_slug", universe)
        .eq("strategy_version", strategyVersion)
        .eq("date", date)
        .order("rank", { ascending: true, nullsFirst: false })
        .order("confidence", { ascending: false })
        .order("symbol", { ascending: true })
        .limit(MAX_ROWS);
      const list = (rows ?? []) as Array<any>;
      rawRows.push(...list);
      universeDates.push({ universe_slug: universe, date_used: date, rows: list.length });
    }

    const latestDate = universeDates
      .filter((u) => u.rows > 0 && u.date_used)
      .sort((a, b) => String(b.date_used ?? "").localeCompare(String(a.date_used ?? "")))[0]?.date_used ?? null;

    if (rawRows.length === 0) {
      return {
        date: latestDate,
        buy: 0,
        watch: 0,
        avoid: 0,
        top: [] as any[],
        rows_display: [] as any[],
        universe_dates: universeDates,
      };
    }

    const shouldValidateEntry = strategyVersion !== "v1_sector_momentum";
    let entryValidatedRows = rawRows;
    if (shouldValidateEntry && latestDate) {
      const symbols = Array.from(new Set(rawRows.map((r) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean)));
      const { data: barsOnDate } = await supabase
        .from("price_bars")
        .select("symbol,close")
        .eq("date", latestDate)
        .in("symbol", symbols);
      const closeBySymbol = new Map<string, number>();
      for (const row of barsOnDate ?? []) {
        const sym = String((row as any)?.symbol ?? "").trim().toUpperCase();
        const close = Number((row as any)?.close);
        if (!sym || !Number.isFinite(close) || close <= 0) continue;
        if (!closeBySymbol.has(sym)) closeBySymbol.set(sym, close);
      }
      entryValidatedRows = rawRows.filter((row) => {
        const sym = String(row.symbol ?? "").trim().toUpperCase();
        const scanClose = closeBySymbol.get(sym);
        if (scanClose == null) return true;
        const entry = Number(row.entry ?? 0);
        if (!Number.isFinite(entry) || entry <= 0) return false;
        return Math.abs((entry - scanClose) / scanClose) <= PRICE_MISMATCH_THRESHOLD_PCT;
      });
    }

    const rowsDisplay = applyDisplayCaps(entryValidatedRows);
    const top = rankRows(rowsDisplay.filter((r) => String(r.signal ?? "").toUpperCase() !== "AVOID")).slice(0, 5);
    return {
      date: latestDate,
      buy: rowsDisplay.filter((r) => String(r.signal ?? "").toUpperCase() === "BUY").length,
      watch: rowsDisplay.filter((r) => String(r.signal ?? "").toUpperCase() === "WATCH").length,
      avoid: rowsDisplay.filter((r) => String(r.signal ?? "").toUpperCase() === "AVOID").length,
      top,
      rows_display: rowsDisplay,
      universe_dates: universeDates,
    };
  }

  const [momentum, trend, sectorSummary] = await Promise.all([
    loadStrategySummary("v1"),
    loadStrategySummary("v1_trend_hold"),
    loadStrategySummary("v1_sector_momentum"),
  ]);

  const sectorGroupsMap = new Map<string, { key: string; name: string; theme: string; rank_score: number }>();
  for (const row of sectorSummary.rows_display ?? []) {
    const g = (row as any)?.reason_json?.group ?? null;
    const key = String(g?.key ?? "").trim();
    if (!key || sectorGroupsMap.has(key)) continue;
    sectorGroupsMap.set(key, {
      key,
      name: String(g?.name ?? key),
      theme: String(g?.theme ?? ""),
      rank_score: Number(g?.group_rank_score ?? 0) || 0,
    });
  }
  const sectorMomentum = {
    ok: (sectorSummary.rows_display ?? []).length > 0,
    date: sectorSummary.date,
    buy: sectorSummary.buy,
    watch: sectorSummary.watch,
    avoid: sectorSummary.avoid,
    top_groups: [...sectorGroupsMap.values()].sort((a, b) => b.rank_score - a.rank_score).slice(0, 4),
    candidates: (sectorSummary.rows_display ?? []).slice(0, 8).map((r: any) => ({
      symbol: String(r.symbol ?? ""),
      signal: String(r.signal ?? "WATCH"),
      entry: Number(r.entry ?? 0),
      stop: Number(r.stop ?? 0),
      industry_group: String(r?.reason_json?.group?.name ?? ""),
    })),
    error: (sectorSummary.rows_display ?? []).length > 0 ? null : "No cached sector scan rows",
  };
  const breadth = await computeMarketBreadth({
    supabase: supabase as any,
    date: momentum.date ?? lctd.lctd ?? null,
    universe_slug: defaultUniverseForStrategy("v1"),
    strategy_version: "v1",
    regime_state: regime?.state ?? null,
  });
  const brokerStatusKey = `broker_snapshot_last_run:${user.id}`;
  const { data: brokerStatusRow } = await supabase
    .from("system_status")
    .select("updated_at,value")
    .eq("key", brokerStatusKey)
    .maybeSingle();
  const brokerSnapshot = (brokerStatusRow?.value ?? null) as BrokerSnapshotValue | null;
  const brokerConnected = Boolean(brokerSnapshot?.connection_ok);
  const brokerAccount = brokerSnapshot?.account ?? null;
  const defaultPortfolioName = String((defaultPortfolio as any)?.name ?? "").trim().toLowerCase();
  const isMainPortfolio = defaultPortfolioName === "main";
  const isBrokerLinked = isMainPortfolio && brokerConnected;
  const modeReason = isBrokerLinked
    ? "Default portfolio name is Main and broker snapshot is connected."
    : !isMainPortfolio
      ? "Default portfolio is not Main, so dashboard remains manual/internal."
      : "Main is selected but broker snapshot is missing or disconnected.";
  const portfolioSourceLabel = isBrokerLinked
    ? "Source: Broker-linked (Tiger read-only)"
    : "Source: Manual portfolio";
  const brokerPositions = Array.isArray(brokerSnapshot?.positions) ? brokerSnapshot.positions : [];

  const { data: openRows } =
    portfolioId
      ? await supabase
          .from("portfolio_positions")
          .select("symbol,shares,quantity,position_size,entry_price")
          .eq("portfolio_id", portfolioId)
          .eq("status", "OPEN")
          .limit(8)
      : ({ data: [] } as any);

  const { data: openRiskRows } =
    portfolioId
      ? await supabase
          .from("portfolio_positions")
          .select("entry_price,stop_price,shares,quantity,position_size,status")
          .eq("portfolio_id", portfolioId)
          .eq("status", "OPEN")
      : ({ data: [] } as any);

  const openPreview: Array<{ symbol: string; qty: number; entry: number }> = ((openRows ?? []) as Array<{
    symbol: string | null;
    shares?: number | null;
    quantity?: number | null;
    position_size?: number | null;
    entry_price?: number | null;
  }>).map((row) => ({
    symbol: String(row.symbol ?? "").trim().toUpperCase(),
    qty: Number(row.shares ?? row.quantity ?? row.position_size ?? 0),
    entry: Number(row.entry_price ?? 0),
  }));

  const openPreviewBroker: Array<{ symbol: string; qty: number; entry: number }> = brokerPositions.map((row) => ({
    symbol: String(row?.symbol ?? "").trim().toUpperCase(),
    qty: Number(row?.quantity ?? 0),
    entry: Number(row?.avg_cost ?? 0),
  }));
  const openPreviewRows = isBrokerLinked ? openPreviewBroker : openPreview;

  const totalExposure = isBrokerLinked
    ? brokerPositions.reduce((sum, row) => sum + (Number(row?.market_value) || 0), 0)
    : (snapshot?.deployed_cost_basis ?? 0);
  const cashAvailable = isBrokerLinked ? (brokerAccount?.cash_available ?? null) : (snapshot?.cash_available ?? null);
  const riskPerTrade =
    typeof (defaultPortfolio as any)?.risk_per_trade === "number" &&
    Number.isFinite(Number((defaultPortfolio as any).risk_per_trade))
      ? Number((defaultPortfolio as any).risk_per_trade)
      : 0.02;
  const accountSize = isBrokerLinked ? (brokerAccount?.equity ?? null) : (snapshot?.account_size ?? null);
  let totalRiskDeployed = 0;
  for (const row of (openRiskRows ?? []) as Array<any>) {
    const entry = Number(row?.entry_price);
    const stop = Number(row?.stop_price);
    const qty = resolveQty(row);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || stop <= 0 || qty <= 0) continue;
    totalRiskDeployed += Math.max(0, (entry - stop) * qty);
  }
  const maxLossIfAllStopsHit = totalRiskDeployed;
  const accountRiskPct =
    typeof accountSize === "number" && Number.isFinite(accountSize) && accountSize > 0
      ? (totalRiskDeployed / accountSize) * 100
      : null;
  const summaryCards = isBrokerLinked
    ? [
        { label: "Broker Equity", value: <PrivacyMoney value={brokerAccount?.equity ?? null} />, subtitle: null, sourceField: "broker.account.equity" },
        {
          label: "Broker Cash Available",
          value: <PrivacyMoney value={brokerAccount?.cash_available ?? null} />,
          subtitle: null,
          sourceField: "broker.account.cash_available",
        },
        { label: "Buying Power", value: <PrivacyMoney value={brokerAccount?.buying_power ?? null} />, subtitle: null, sourceField: "broker.account.buying_power" },
        {
          label: "Broker Positions",
          value: String(brokerSnapshot?.positions_count ?? brokerPositions.length ?? 0),
          subtitle: null,
          sourceField: "broker.positions_count",
        },
        {
          label: "Tracked Open Positions",
          value: String(snapshot?.open_count ?? 0),
          subtitle: "Internal records",
          sourceField: "internal.snapshot.open_count",
        },
      ]
    : [
        { label: "Account Size", value: <PrivacyMoney value={snapshot?.account_size ?? null} />, subtitle: null, sourceField: "internal.snapshot.account_size" },
        {
          label: "Cash Available",
          value: (
            <>
              <PrivacyMoney value={snapshot?.cash_available ?? null} /> ({snapshot?.cash_source === "manual" ? "Exact" : "Estimated"})
            </>
          ),
          subtitle: null,
          sourceField: "internal.snapshot.cash_available",
        },
        { label: "Capital Deployed", value: <PrivacyMoney value={snapshot?.deployed_cost_basis ?? null} />, subtitle: "Cost basis", sourceField: "internal.snapshot.deployed_cost_basis" },
        { label: "Open Positions", value: String(snapshot?.open_count ?? 0), subtitle: null, sourceField: "internal.snapshot.open_count" },
        { label: "Risk / Trade", value: `${(riskPerTrade * 100).toFixed(1)}%`, subtitle: null, sourceField: "internal.portfolio.risk_per_trade" },
      ];
  const topSignals = momentum.top.slice(0, 5);
  const topSymbols = Array.from(
    new Set(topSignals.map((row: any) => String(row.symbol ?? "").trim().toUpperCase()).filter(Boolean))
  );
  let topQuoteBySymbol: QuoteMap = {};
  if (topSymbols.length > 0) {
    try {
      const qReq = new Request("http://localhost/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols: topSymbols }),
      });
      const qRes = await quotesPost(qReq);
      const qJson = await qRes.json().catch(() => null);
      if (qRes.ok && qJson?.ok && qJson?.quotes && typeof qJson.quotes === "object") {
        topQuoteBySymbol = qJson.quotes as QuoteMap;
      }
    } catch {
      topQuoteBySymbol = {};
    }
  }
  const earningsRiskBySymbol = await lookupEarningsRiskForSymbols(topSymbols);
  if (topSymbols.length > 0) {
    for (const symbol of topSymbols) {
      const existing = topQuoteBySymbol[symbol];
      if (existing && typeof existing.price === "number" && Number.isFinite(existing.price)) continue;
      const { data: barRows } = await supabase
        .from("price_bars")
        .select("date,close")
        .eq("symbol", symbol)
        .order("date", { ascending: false })
        .limit(1);
      const latest = Array.isArray(barRows) ? barRows[0] : null;
      const close = Number((latest as any)?.close);
      const date = String((latest as any)?.date ?? "");
      if (Number.isFinite(close) && close > 0 && date) {
        topQuoteBySymbol[symbol] = {
          price: close,
          asOf: date,
          source: "eod_close",
        };
      }
    }
  }

  return (
    <AppShell currentPath="/dashboard" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-[2.15rem]">Dashboard</h1>
          </div>
          <p className="text-sm leading-6 text-slate-600">Morning briefing for portfolio, market, and ideas.</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="surface-chip inline-flex px-2.5 py-1 text-xs font-medium text-slate-700">
              {portfolioSourceLabel}
            </p>
            <div className="flex items-center gap-2">
              <TickerCheckClient breadthState={breadth.breadthState} breadthLabel={breadth.breadthLabel} />
              <PrivacyToggle />
            </div>
          </div>
          {showDiagnostics ? (
            <div className="mt-2 rounded-xl border border-[#e5d8c4] bg-[#fffdf8] px-3 py-2 text-[11px] text-slate-600">
              build={buildMarker}
              {" • "}page_marker={DASHBOARD_PAGE_MARKER}
              {" • "}env={envLabel}
              {" • "}portfolio_id={portfolioId || "—"}
              {" • "}portfolio_name={String((defaultPortfolio as any)?.name ?? "—")}
              {" • "}resolved_mode={isBrokerLinked ? "broker_linked" : "manual"}
              {" • "}mode_reason={modeReason}
              {" • "}broker_snapshot_found={brokerSnapshot ? "true" : "false"}
              {" • "}broker_connected={brokerConnected ? "true" : "false"}
              {" • "}broker_snapshot_updated_at={brokerStatusRow?.updated_at ?? "—"}
              {" • "}headline_source={isBrokerLinked ? "broker_snapshot" : "internal_portfolio_snapshot"}
              {" • "}headline_fields={summaryCards.map((c) => c.sourceField).join(",")}
            </div>
          ) : null}
        </div>

        <section className="surface-panel px-3 py-2.5">
          <div className={`grid gap-2 ${isBrokerLinked ? "sm:grid-cols-2 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-5"}`}>
            {summaryCards.map((card) => (
              <div key={card.label} className="surface-card px-3 py-2">
                <div className="muted-label uppercase tracking-[0.06em]">{card.label}</div>
                <div className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">{card.value}</div>
                {card.subtitle ? <div className="mt-1 text-[11px] text-slate-500">{card.subtitle}</div> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          <section className="surface-panel p-3.5">
            <div className="section-title">Market Context</div>
            <div className="mt-2.5 space-y-2 text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                    regime?.state === "FAVORABLE"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  {regime?.state ?? "—"}
                </span>
                <span
                  className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                    breadth.breadthState === "STRONG"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : breadth.breadthState === "MIXED"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {breadth.breadthState}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="surface-card px-2.5 py-1.5">Latest scan: <span className="font-mono">{momentum.date ?? lctd.lctd ?? "—"}</span></div>
                <div className="surface-card px-2.5 py-1.5">LCTD: <span className="font-mono">{lctd.lctd ?? "—"}</span></div>
                <div className="surface-card px-2.5 py-2">Close: <span className="font-mono">{regime?.close != null ? Number(regime.close).toFixed(2) : "—"}</span></div>
                <div className="surface-card px-2.5 py-2">SMA200: <span className="font-mono">{regime?.sma200 != null ? Number(regime.sma200).toFixed(2) : "—"}</span></div>
                <div className="surface-card px-2.5 py-2">%&gt;SMA50: <span className="font-mono">{breadth.pctAboveSma50.toFixed(1)}%</span></div>
                <div className="surface-card col-span-2 px-2.5 py-2">%&gt;SMA200: <span className="font-mono">{breadth.pctAboveSma200.toFixed(1)}%</span></div>
              </div>
            </div>
          </section>

          <section className="surface-panel p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <div className="section-title">Top Signals Today</div>
              <Link
                href="/ideas?strategy=momentum"
                className="rounded-lg border border-[#d9ccb5] bg-[#efe6d6] px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-[#e8ddca]"
              >
                Open Ideas
              </Link>
            </div>
            <div className="mb-2 grid grid-cols-3 gap-2 text-center">
              <div className="surface-card px-2 py-1.5">
                <div className="muted-label">BUY</div>
                <div className="mt-0.5 text-base font-semibold text-emerald-700">{momentum.buy}</div>
              </div>
              <div className="surface-card px-2 py-1.5">
                <div className="muted-label">WATCH</div>
                <div className="mt-0.5 text-base font-semibold text-amber-700">{momentum.watch}</div>
              </div>
              <div className="surface-card px-2 py-1.5">
                <div className="muted-label">AVOID</div>
                <div className="mt-0.5 text-base font-semibold text-rose-700">{momentum.avoid}</div>
              </div>
            </div>
            <div className="space-y-2.5">
              {topSignals.slice(0, 4).map((row: any) => (
                <Link
                  key={row.symbol}
                  href={`/ideas?strategy=momentum&symbol=${encodeURIComponent(String(row.symbol))}`}
                  className="surface-card flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-[#fff9f0]"
                >
                  <div className="min-w-0 pr-3">
                    <div className="text-sm font-semibold tracking-tight text-slate-900">{row.symbol}</div>
                    <div className="truncate text-[11px] text-slate-500">{row.reason_summary ?? "—"}</div>
                  </div>
                  <span
                    className={
                      row.signal === "BUY"
                        ? "shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                        : row.signal === "WATCH"
                          ? "shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700"
                          : "shrink-0 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold text-rose-700"
                    }
                  >
                    {row.signal}
                  </span>
                </Link>
              ))}
              {topSignals.length === 0 ? <div className="text-xs text-slate-500">No ranked signals.</div> : null}
            </div>
          </section>

          <section className="surface-panel p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <div className="section-title">Sector Momentum</div>
              <Link href="/ideas?strategy=sector" className="rounded-lg border border-[#d8c8aa] bg-[#f1e4cd] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-[#ecdcbf]">
                Open
              </Link>
            </div>
            {!sectorMomentum.ok ? (
              <div className="text-sm text-amber-700">Unavailable: {sectorMomentum.error ?? "unknown"}</div>
            ) : (
              <div className="space-y-2.5">
                {(sectorMomentum.top_groups ?? []).slice(0, 3).map((g) => (
                  <div key={g.key} className="surface-card flex items-center justify-between px-3 py-2.5 text-sm">
                    <div className="min-w-0 pr-3">
                      <div className="truncate font-medium text-slate-900">{g.name}</div>
                      <div className="truncate text-[11px] text-slate-500">{g.theme}</div>
                    </div>
                    <span className="text-xs font-semibold text-slate-700">{g.rank_score.toFixed(1)}</span>
                  </div>
                ))}
                {(sectorMomentum.candidates ?? []).slice(0, 1).map((c) => (
                  <Link
                    key={c.symbol}
                    href={`/ideas?strategy=sector&symbol=${encodeURIComponent(String(c.symbol))}`}
                    className="surface-card block px-3 py-2.5 text-xs transition-colors hover:bg-[#fff9f0]"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-slate-900">{c.symbol}</span>
                      <span className="font-semibold text-slate-700">{c.signal}</span>
                    </div>
                    <div className="mt-1 text-slate-600">{c.industry_group}</div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="surface-panel p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="section-title">Portfolio Exposure</div>
              <Link href="/positions" className="rounded-lg border border-[#d8c8aa] bg-[#f1e4cd] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-[#ecdcbf]">
                Open positions
              </Link>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <div className="surface-card px-2.5 py-2">
                <div className="muted-label">Total Exposure</div>
                <div className="mt-0.5 text-base font-semibold text-slate-900"><PrivacyMoney value={totalExposure} /></div>
              </div>
              <div className="surface-card px-2.5 py-2">
                <div className="muted-label">Cash Available</div>
                <div className="mt-0.5 text-base font-semibold text-slate-900"><PrivacyMoney value={cashAvailable} /></div>
              </div>
              <div className="surface-card px-2.5 py-2">
                <div className="muted-label">Risk Deployed</div>
                <div className="mt-0.5 text-base font-semibold text-slate-900"><PrivacyMoney value={totalRiskDeployed} /></div>
              </div>
              <div className="surface-card px-2.5 py-2">
                <div className="muted-label">Max Stop Loss</div>
                <div className="mt-0.5 text-base font-semibold text-slate-900"><PrivacyMoney value={maxLossIfAllStopsHit} /></div>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="text-xs text-slate-500">
                {isBrokerLinked ? "Showing broker-held positions (read-only snapshot)." : "Showing internal tracked open positions."}
              </div>
              {openPreviewRows.length === 0 ? <div className="text-slate-500">No open positions.</div> : null}
              {Array.from(new Map(openPreviewRows.map((r) => [r.symbol, r])).values()).map((row) => (
                <div
                  key={row.symbol}
                  className="flex items-center justify-between rounded-xl border border-[#eadfce] bg-[#fffdf8] px-3.5 py-2.5"
                >
                  <span className="font-medium">{row.symbol}</span>
                  <span className="text-slate-600">
                    {Number.isFinite(row.qty) ? Math.round(row.qty) : "—"} @ {Number.isFinite(row.entry) ? row.entry.toFixed(2) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="surface-panel p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="section-title">Execution & Broker</div>
              <Link
                href="/broker"
                className="rounded-lg border border-[#d8c8aa] bg-[#f1e4cd] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-[#ecdcbf]"
              >
                Open broker
              </Link>
            </div>
            <div className="space-y-2">
              <div className="surface-card grid grid-cols-2 gap-2 px-3 py-2 text-sm">
                <div>
                  <div className="muted-label">Broker status</div>
                  <div className="mt-0.5 font-semibold text-slate-900">
                    {brokerConnected ? "Connected" : brokerSnapshot?.configured ? "Configured / Not Connected" : "Not Configured"}
                  </div>
                </div>
                <div>
                  <div className="muted-label">Last sync</div>
                  <div className="mt-0.5 text-xs text-slate-700">{brokerStatusRow?.updated_at ?? "—"}</div>
                </div>
              </div>
              <div className="surface-card flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">Momentum Swing</span>
                <span className="text-slate-700">BUY {momentum.buy} / WATCH {momentum.watch}</span>
              </div>
              <div className="surface-card flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">Trend Hold</span>
                <span className="text-slate-700">BUY {trend.buy} / WATCH {trend.watch}</span>
              </div>
              <div className="surface-card flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">Sector Momentum</span>
                <span className="text-slate-700">BUY {sectorMomentum.buy} / WATCH {sectorMomentum.watch}</span>
              </div>
              <div className="surface-card flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">Account Risk %</span>
                <span className="text-slate-700">
                  {accountRiskPct != null && Number.isFinite(accountRiskPct) ? `${accountRiskPct.toFixed(1)}%` : "—"}
                </span>
              </div>
            </div>
          </div>
        </section>

      </div>
    </AppShell>
  );
}
