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

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

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

type QuoteMap = Record<
  string,
  {
    price: number;
    asOf: string;
    source: "snapshot" | "eod_close";
  } | null
>;
const PRICE_MISMATCH_THRESHOLD_PCT = 0.6;

export const dynamic = "force-dynamic";

function resolveQty(row: any) {
  const raw = row?.shares ?? row?.quantity ?? row?.position_size ?? row?.qty ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default async function DashboardPage() {
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
    const { data: latestRow } = await supabase
      .from("daily_scans")
      .select("date")
      .eq("universe_slug", "core_800")
      .eq("strategy_version", strategyVersion)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const date = latestRow?.date ? String(latestRow.date) : null;
    if (!date) return { date: null, buy: 0, watch: 0, avoid: 0, top: [] as any[] };

    const { data: rows } = await supabase
      .from("daily_scans")
      .select("symbol,signal,confidence,rank,rank_score,reason_summary,reason_json,entry")
      .eq("universe_slug", "core_800")
      .eq("strategy_version", strategyVersion)
      .eq("date", date)
      .order("rank_score", { ascending: false, nullsFirst: false })
      .order("confidence", { ascending: false })
      .order("symbol", { ascending: true })
      .limit(50);
    const list = (rows ?? []) as Array<{
      symbol: string;
      signal: "BUY" | "WATCH" | "AVOID";
      confidence: number | null;
      rank: number | null;
      rank_score: number | null;
      reason_summary: string | null;
      reason_json: any;
      entry: number | null;
    }>;
    const symbols = Array.from(new Set(list.map((r) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean)));
    const { data: barsOnDate } = await supabase
      .from("price_bars")
      .select("symbol,close")
      .eq("date", date)
      .in("symbol", symbols);
    const closeBySymbol = new Map<string, number>();
    for (const row of barsOnDate ?? []) {
      const sym = String((row as any)?.symbol ?? "").trim().toUpperCase();
      const close = Number((row as any)?.close);
      if (!sym || !Number.isFinite(close) || close <= 0) continue;
      if (!closeBySymbol.has(sym)) closeBySymbol.set(sym, close);
    }
    const validated = list.filter((row) => {
      const sym = String(row.symbol ?? "").trim().toUpperCase();
      const scanClose = closeBySymbol.get(sym);
      if (scanClose == null) return true;
      const entry = Number(row.entry ?? 0);
      if (!Number.isFinite(entry) || entry <= 0) return false;
      return Math.abs((entry - scanClose) / scanClose) <= PRICE_MISMATCH_THRESHOLD_PCT;
    });
    return {
      date,
      buy: validated.filter((r: any) => r.signal === "BUY").length,
      watch: validated.filter((r: any) => r.signal === "WATCH").length,
      avoid: validated.filter((r: any) => r.signal === "AVOID").length,
      top: validated.filter((r) => r.signal !== "AVOID").slice(0, 5),
    };
  }

  const [momentum, trend] = await Promise.all([
    loadStrategySummary("v2_core_momentum"),
    loadStrategySummary("v1_trend_hold"),
  ]);
  const breadth = await computeMarketBreadth({
    supabase: supabase as any,
    date: momentum.date ?? lctd.lctd ?? null,
    universe_slug: "core_800",
    strategy_version: "v2_core_momentum",
    regime_state: regime?.state ?? null,
  });

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

  const totalExposure = snapshot?.deployed_cost_basis ?? 0;
  const cashAvailable = snapshot?.cash_available ?? null;
  const riskPerTrade =
    typeof (defaultPortfolio as any)?.risk_per_trade === "number" &&
    Number.isFinite(Number((defaultPortfolio as any).risk_per_trade))
      ? Number((defaultPortfolio as any).risk_per_trade)
      : 0.02;
  const accountSize = snapshot?.account_size ?? null;
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
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Morning briefing for portfolio, market, and ideas.</p>
        </div>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-5 shadow-[0_6px_18px_rgba(88,63,36,0.05)]">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Account size</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{money(snapshot?.account_size ?? null)}</div>
          </div>
          <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-5 shadow-[0_6px_18px_rgba(88,63,36,0.05)]">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Capital deployed</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{money(snapshot?.deployed_cost_basis ?? null)}</div>
            <div className="mt-1 text-xs text-slate-500">Cost basis</div>
          </div>
          <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-5 shadow-[0_6px_18px_rgba(88,63,36,0.05)]">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Cash available</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              {money(snapshot?.cash_available ?? null)}{" "}
              <span className="text-xs font-medium text-slate-500">
                ({snapshot?.cash_source === "manual" ? "Exact" : "Estimated"})
              </span>
            </div>
          </div>
          <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-5 shadow-[0_6px_18px_rgba(88,63,36,0.05)]">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Market value</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{money(snapshot?.market_value_optional ?? null)}</div>
          </div>
          <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-5 shadow-[0_6px_18px_rgba(88,63,36,0.05)]">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Open positions</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{snapshot?.open_count ?? 0}</div>
          </div>
          <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-5 shadow-[0_6px_18px_rgba(88,63,36,0.05)]">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Risk deployed</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">—</div>
          </div>
        </section>

        <TickerCheckClient breadthState={breadth.breadthState} breadthLabel={breadth.breadthLabel} />

        <section className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-5 shadow-[0_6px_18px_rgba(88,63,36,0.05)]">
          <div className="text-base font-semibold tracking-tight text-slate-900">Portfolio Risk</div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total Exposure</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{money(totalExposure)}</div>
            </div>
            <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Cash Available</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{money(cashAvailable)}</div>
            </div>
            <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Risk / Trade</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{(riskPerTrade * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Risk Deployed</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{money(totalRiskDeployed)}</div>
            </div>
            <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Max Stop Loss Risk</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{money(maxLossIfAllStopsHit)}</div>
            </div>
            <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Account Risk %</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
                {accountRiskPct != null && Number.isFinite(accountRiskPct) ? `${accountRiskPct.toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#e0d0b4] bg-[#fff8ed] p-5">
          <div className="text-base font-semibold tracking-tight">Market Context</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span
              className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                regime?.state === "FAVORABLE"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {regime?.state ?? "—"}
            </span>
            <span className="rounded-full border border-[#e5d9c8] bg-[#fffdf8] px-2 py-1 text-xs font-medium">
              LCTD: <span className="font-mono">{lctd.lctd ?? "—"}</span>
            </span>
            <span className="rounded-full border border-[#e5d9c8] bg-[#fffdf8] px-2 py-1 text-xs font-medium">
              Close: <span className="font-mono">{regime?.close != null ? Number(regime.close).toFixed(2) : "—"}</span>
            </span>
            <span className="rounded-full border border-[#e5d9c8] bg-[#fffdf8] px-2 py-1 text-xs font-medium">
              SMA200: <span className="font-mono">{regime?.sma200 != null ? Number(regime.sma200).toFixed(2) : "—"}</span>
            </span>
            <span className="rounded-full border border-[#e5d9c8] bg-[#fffdf8] px-2 py-1 text-xs font-medium">
              %&gt;SMA50: <span className="font-mono">{breadth.pctAboveSma50.toFixed(1)}%</span>
            </span>
            <span className="rounded-full border border-[#e5d9c8] bg-[#fffdf8] px-2 py-1 text-xs font-medium">
              %&gt;SMA200: <span className="font-mono">{breadth.pctAboveSma200.toFixed(1)}%</span>
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
            {breadth.breadthState !== "STRONG" ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                {breadth.breadthLabel}
              </span>
            ) : null}
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-[#dfcfb2] bg-[#fff7ec] p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold tracking-tight">Momentum Swing</div>
                <div className="mt-1 h-0.5 w-14 rounded-full bg-emerald-200" />
              </div>
              <Link href="/ideas?strategy=v2_core_momentum" className="rounded-lg border border-[#d8c8aa] bg-[#f1e4cd] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-[#ecdcbf]">
                Open ideas
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-700">
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${signalPill("BUY")}`}>BUY <span className="ml-1 text-sm">{momentum.buy}</span></span>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${signalPill("WATCH")}`}>WATCH <span className="ml-1 text-sm">{momentum.watch}</span></span>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${signalPill("AVOID")}`}>AVOID <span className="ml-1 text-sm">{momentum.avoid}</span></span>
            </div>
          </div>
          <div className="rounded-2xl border border-[#dfcfb2] bg-[#fff7ec] p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold tracking-tight">Trend Hold</div>
                <div className="mt-1 h-0.5 w-14 rounded-full bg-sky-200" />
              </div>
              <Link href="/ideas?strategy=v1_trend_hold" className="rounded-lg border border-[#d8c8aa] bg-[#f1e4cd] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-[#ecdcbf]">
                Open ideas
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-700">
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${signalPill("BUY")}`}>BUY <span className="ml-1 text-sm">{trend.buy}</span></span>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${signalPill("WATCH")}`}>WATCH <span className="ml-1 text-sm">{trend.watch}</span></span>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${signalPill("AVOID")}`}>AVOID <span className="ml-1 text-sm">{trend.avoid}</span></span>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <section className="rounded-[28px] border border-[#e8decd] bg-[#f8f3e8] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-slate-900">Top Ranked Signals</h2>
              <Link
                href="/ideas?strategy=momentum"
                className="rounded-xl border border-[#d9ccb5] bg-[#efe6d6] px-4 py-2 text-sm font-medium text-slate-800 hover:bg-[#e8ddca]"
              >
                View all
              </Link>
            </div>

            <div className="space-y-3">
              {topSignals.map((row: any) => {
                const symbol = String(row.symbol ?? "").trim().toUpperCase();
                const quote = topQuoteBySymbol[symbol];
                const rawLast = typeof quote?.price === "number" && Number.isFinite(quote.price) ? quote.price : null;
                const entry = typeof row.entry === "number" && Number.isFinite(row.entry) ? row.entry : null;
                const mismatch =
                  rawLast !== null &&
                  entry !== null &&
                  entry > 0 &&
                  Math.abs((rawLast - entry) / entry) > PRICE_MISMATCH_THRESHOLD_PCT;
                const last = mismatch ? null : rawLast;
                const delta = last !== null && entry !== null && entry > 0 ? ((last - entry) / entry) * 100 : null;
                const atr14 = extractAtr14(row.reason_json);
                const atrDist =
                  atr14 !== null && atr14 > 0 && last !== null && entry !== null ? Math.abs(last - entry) / atr14 : null;
                const sourceBadgeClass =
                  quote?.source === "snapshot"
                    ? "border-sky-200 bg-sky-50 text-sky-700"
                    : "border-slate-200 bg-slate-50 text-slate-700";
                const sourceLabel = quote?.source === "snapshot" ? "LIVE" : quote?.source === "eod_close" ? "EOD" : null;
                const status =
                  mismatch
                    ? "Price mismatch"
                    : last !== null && entry !== null && entry > 0
                      ? getEntryStatus({
                          price: last,
                          zone_low: getBuyZone({ strategy_version: "v2_core_momentum", model_entry: entry }).zone_low,
                          zone_high: getBuyZone({ strategy_version: "v2_core_momentum", model_entry: entry }).zone_high,
                        })
                      : "No live price";
                const exec = applyBreadthToAction(
                  applyEarningsRiskToAction(mapExecutionState(status), earningsRiskBySymbol[symbol] ?? null),
                  breadth
                );

                return (
                  <Link
                    key={row.symbol}
                    href={`/ideas?strategy=momentum&symbol=${encodeURIComponent(String(row.symbol))}`}
                    legacyBehavior
                  >
                    <a className="block w-full cursor-pointer rounded-xl border border-[#eadfce] bg-[#fffdf8] px-4 py-3 transition hover:-translate-y-[1px] hover:border-[#dac9ab] hover:bg-[#fff9f0]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xl font-semibold tracking-tight text-slate-900">{symbol}</div>
                            {sourceLabel ? (
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceBadgeClass}`}>
                                {sourceLabel}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                            <div className="rounded-lg border border-[#e7dccb] bg-[#fffaf2] px-2.5 py-1.5">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Last</div>
                              <div className="font-semibold text-slate-800">{fmtPrice(last)}</div>
                            </div>
                            <div className="rounded-lg border border-[#e7dccb] bg-[#fffaf2] px-2.5 py-1.5">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Entry</div>
                              <div className="font-semibold text-slate-800">{fmtPrice(entry)}</div>
                            </div>
                            <div className="rounded-lg border border-[#e7dccb] bg-[#fffaf2] px-2.5 py-1.5">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">Delta</div>
                              <div
                                className={`font-semibold ${
                                  typeof delta === "number" && Number.isFinite(delta)
                                    ? delta >= 0
                                      ? "text-emerald-700"
                                      : "text-rose-700"
                                    : "text-slate-800"
                                }`}
                              >
                                {fmtSignedPct(delta)}
                              </div>
                            </div>
                            <div className="rounded-lg border border-[#e7dccb] bg-[#fffaf2] px-2.5 py-1.5">
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">ATR Dist</div>
                              <div className="font-semibold text-slate-800">
                                {atrDist !== null && Number.isFinite(atrDist) ? `${atrDist.toFixed(1)} ATR` : "—"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${actionPill(exec.action)}`}>
                              {exec.action}
                            </span>
                            <span className="rounded-full border border-[#e4d7c3] bg-[#fff8ee] px-2 py-0.5 text-[11px] text-slate-600">
                              {exec.reasonLabel}
                            </span>
                            {mismatch ? (
                              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                MISMATCH
                              </span>
                            ) : null}
                            {earningsRiskBySymbol[symbol]?.earningsLabel ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                {earningsRiskBySymbol[symbol]?.earningsLabel}
                              </span>
                            ) : null}
                            {exec.breadthLabel ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                {exec.breadthLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <span
                          className={
                            row.signal === "BUY"
                              ? "shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                              : row.signal === "WATCH"
                                ? "shrink-0 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                                : "shrink-0 rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                          }
                        >
                          {row.signal}
                        </span>
                      </div>
                    </a>
                  </Link>
                );
              })}
            </div>
          </section>
          <div className="rounded-2xl border border-[#dfcfb2] bg-[#fff7ec] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-base font-semibold tracking-tight">Open Positions Snapshot</div>
              <Link href="/positions" className="rounded-lg border border-[#d8c8aa] bg-[#f1e4cd] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-[#ecdcbf]">
                Open positions
              </Link>
            </div>
            <div className="space-y-2 text-sm">
              {openPreview.length === 0 ? <div className="text-slate-500">No open positions.</div> : null}
              {Array.from(new Map(openPreview.map((r) => [r.symbol, r])).values()).map((row) => (
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
        </section>
      </div>
    </AppShell>
  );
}
