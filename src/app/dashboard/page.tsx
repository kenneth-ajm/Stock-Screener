import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import { getPortfolioSnapshot } from "@/lib/portfolio_snapshot";
import { getLCTD } from "@/lib/scan_status";

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function signalPill(signal: "BUY" | "WATCH" | "AVOID") {
  if (signal === "BUY") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (signal === "WATCH") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
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
          <div className="rounded-2xl border border-[#dfcfb2] bg-[#fff7ec] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-base font-semibold tracking-tight">Top Ranked Signals</div>
              <Link href="/ideas" className="rounded-lg border border-[#d8c8aa] bg-[#f1e4cd] px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-[#ecdcbf]">
                View all
              </Link>
            </div>
            <div className="space-y-2 text-sm">
              {momentum.top.slice(0, 5).map((row: any) => (
                <Link
                  key={row.symbol}
                  href={`/ideas?strategy=momentum&symbol=${encodeURIComponent(String(row.symbol ?? ""))}`}
                  className="cursor-pointer rounded-xl border border-[#eadfce] bg-[#fffdf8] px-3.5 py-2.5 transition hover:-translate-y-[1px] hover:border-[#dac9ab] hover:bg-[#fff9f0]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{row.symbol}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${signalPill(row.signal)}`}>
                      {row.signal}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-600">{row.reason_summary ?? "—"}</div>
                </Link>
              ))}
            </div>
          </div>
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
