import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import { getPortfolioSnapshot } from "@/lib/portfolio_snapshot";
import { getLCTD } from "@/lib/scan_status";

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

export const dynamic = "force-dynamic";

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
      .select("symbol,signal,confidence,rank,rank_score,reason_summary")
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
    }>;
    return {
      date,
      buy: list.filter((r: any) => r.signal === "BUY").length,
      watch: list.filter((r: any) => r.signal === "WATCH").length,
      avoid: list.filter((r: any) => r.signal === "AVOID").length,
      top: list.filter((r) => r.signal !== "AVOID").slice(0, 5),
    };
  }

  const [momentum, trend] = await Promise.all([
    loadStrategySummary("v2_core_momentum"),
    loadStrategySummary("v1_trend_hold"),
  ]);

  const { data: openRows } =
    portfolioId
      ? await supabase
          .from("portfolio_positions")
          .select("symbol,shares,quantity,position_size,entry_price")
          .eq("portfolio_id", portfolioId)
          .eq("status", "OPEN")
          .limit(8)
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

  return (
    <AppShell currentPath="/dashboard" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Morning briefing for portfolio, market, and ideas.</p>
        </div>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Account size</div>
            <div className="mt-2 text-2xl font-semibold">{money(snapshot?.account_size ?? null)}</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Capital deployed (cost basis)</div>
            <div className="mt-2 text-2xl font-semibold">{money(snapshot?.deployed_cost_basis ?? null)}</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Cash available</div>
            <div className="mt-2 text-2xl font-semibold">
              {money(snapshot?.cash_available ?? null)}{" "}
              <span className="text-sm text-slate-500">
                ({snapshot?.cash_source === "manual" ? "Exact" : "Estimated"})
              </span>
            </div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Market value</div>
            <div className="mt-2 text-2xl font-semibold">{money(snapshot?.market_value_optional ?? null)}</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Open positions</div>
            <div className="mt-2 text-2xl font-semibold">{snapshot?.open_count ?? 0}</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Risk deployed</div>
            <div className="mt-2 text-2xl font-semibold">—</div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
          <div className="text-sm font-semibold">Market Context</div>
          <div className="mt-2 text-sm text-slate-700">
            SPY regime: <span className="font-semibold">{regime?.state ?? "—"}</span>
            {" • "}LCTD: <span className="font-mono">{lctd.lctd ?? "—"}</span>
            {" • "}Close/SMA200:{" "}
            <span className="font-mono">
              {regime?.close != null ? Number(regime.close).toFixed(2) : "—"} /{" "}
              {regime?.sma200 != null ? Number(regime.sma200).toFixed(2) : "—"}
            </span>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Momentum Swing</div>
              <Link href="/ideas?strategy=v2_core_momentum" className="text-xs text-slate-600 underline">
                Open ideas
              </Link>
            </div>
            <div className="mt-2 text-sm text-slate-700">
              BUY {momentum.buy} • WATCH {momentum.watch} • AVOID {momentum.avoid}
            </div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Trend Hold</div>
              <Link href="/ideas?strategy=v1_trend_hold" className="text-xs text-slate-600 underline">
                Open ideas
              </Link>
            </div>
            <div className="mt-2 text-sm text-slate-700">
              BUY {trend.buy} • WATCH {trend.watch} • AVOID {trend.avoid}
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">Top Ranked Signals</div>
              <Link href="/ideas" className="text-xs text-slate-600 underline">
                View all
              </Link>
            </div>
            <div className="space-y-2 text-sm">
              {momentum.top.slice(0, 5).map((row: any) => (
                <div key={row.symbol} className="flex items-center justify-between rounded-xl border border-[#eadfce] px-3 py-2">
                  <span className="font-medium">{row.symbol}</span>
                  <span className="text-slate-600">{row.signal}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">Open Positions Snapshot</div>
              <Link href="/positions" className="text-xs text-slate-600 underline">
                Open positions
              </Link>
            </div>
            <div className="space-y-2 text-sm">
              {openPreview.length === 0 ? <div className="text-slate-500">No open positions.</div> : null}
              {openPreview.map((row) => (
                <div key={row.symbol} className="flex items-center justify-between rounded-xl border border-[#eadfce] px-3 py-2">
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
