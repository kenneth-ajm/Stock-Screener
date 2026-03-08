import AppShell from "@/components/app-shell";
import PaperPositionsClient from "@/app/paper/PaperPositionsClient";
import { getWorkspaceContext } from "@/lib/workspace_context";

export const dynamic = "force-dynamic";

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default async function PaperPage() {
  const { supabase, user, portfolios, defaultPortfolio } = await getWorkspaceContext("/paper");
  const portfolioId = defaultPortfolio?.id ? String(defaultPortfolio.id) : null;

  let query = supabase
    .from("paper_positions")
    .select(
      "id,symbol,strategy_version,entry_price,stop_price,tp1,tp2,shares,status,reason_summary,notes,opened_at,closed_at,exit_price,created_at,updated_at"
    )
    .eq("user_id", user.id)
    .order("opened_at", { ascending: false })
    .limit(500);
  if (portfolioId) query = query.eq("portfolio_id", portfolioId);
  const { data: paperRows, error: paperError } = await query;

  const rows = (paperRows ?? []).map((r: any) => ({
    ...r,
    symbol: String(r?.symbol ?? "").trim().toUpperCase(),
  }));

  const symbols = Array.from(
    new Set(rows.map((r: any) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean))
  );
  const latestPriceBySymbol: Record<string, number | null> = {};
  if (symbols.length > 0) {
    const { data: bars } = await supabase
      .from("price_bars")
      .select("symbol,date,close")
      .in("symbol", symbols)
      .order("symbol", { ascending: true })
      .order("date", { ascending: false });
    for (const bar of bars ?? []) {
      const sym = String((bar as any).symbol ?? "").trim().toUpperCase();
      if (!sym || latestPriceBySymbol[sym] != null) continue;
      latestPriceBySymbol[sym] = toNum((bar as any).close);
    }
  }

  const openRows = rows.filter((r: any) => !["CLOSED", "STOPPED", "TP1_HIT", "TP2_HIT"].includes(String(r.status ?? "")));
  const closedRows = rows.filter((r: any) => ["CLOSED", "STOPPED", "TP1_HIT", "TP2_HIT"].includes(String(r.status ?? "")));

  const unrealizedPnl = openRows.reduce((sum: number, r: any) => {
    const last = toNum(latestPriceBySymbol[String(r.symbol ?? "").trim().toUpperCase()]);
    const entry = toNum(r.entry_price);
    const shares = toNum(r.shares) ?? 0;
    if (last == null || entry == null || shares <= 0) return sum;
    return sum + (last - entry) * shares;
  }, 0);

  const realizedPnl = closedRows.reduce((sum: number, r: any) => {
    const exit = toNum(r.exit_price);
    const entry = toNum(r.entry_price);
    const shares = toNum(r.shares) ?? 0;
    if (exit == null || entry == null || shares <= 0) return sum;
    return sum + (exit - entry) * shares;
  }, 0);

  return (
    <AppShell currentPath="/paper" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Paper Positions</h1>
          <p className="text-sm text-slate-600">
            Simulated execution only. Paper positions are separate from broker holdings.
          </p>
        </div>

        {paperError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Failed to load paper positions: {paperError.message}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-5">
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Open paper positions</div>
            <div className="mt-1 text-2xl font-semibold">{openRows.length}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Closed paper positions</div>
            <div className="mt-1 text-2xl font-semibold">{closedRows.length}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Unrealized P/L</div>
            <div className="mt-1 text-2xl font-semibold">${unrealizedPnl.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Realized P/L</div>
            <div className="mt-1 text-2xl font-semibold">${realizedPnl.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Total paper positions</div>
            <div className="mt-1 text-2xl font-semibold">{rows.length}</div>
          </div>
        </div>

        <PaperPositionsClient initialRows={rows as any} latestPriceBySymbol={latestPriceBySymbol} />
      </div>
    </AppShell>
  );
}
