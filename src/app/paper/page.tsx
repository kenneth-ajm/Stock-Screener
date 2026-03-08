import AppShell from "@/components/app-shell";
import PaperPositionsClient from "@/app/paper/PaperPositionsClient";
import { getWorkspaceContext } from "@/lib/workspace_context";

export const dynamic = "force-dynamic";

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
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
  const missingPaperTable =
    String(paperError?.code ?? "") === "PGRST205" ||
    /paper_positions/i.test(String(paperError?.message ?? ""));

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

  const closedWithPnl = closedRows
    .map((r: any) => {
      const exit = toNum(r.exit_price);
      const entry = toNum(r.entry_price);
      const shares = toNum(r.shares) ?? 0;
      if (exit == null || entry == null || shares <= 0) return null;
      return {
        ...r,
        pnl: (exit - entry) * shares,
      };
    })
    .filter(Boolean) as Array<any>;

  const winningClosed = closedWithPnl.filter((r: any) => Number(r.pnl ?? 0) > 0);
  const losingClosed = closedWithPnl.filter((r: any) => Number(r.pnl ?? 0) < 0);
  const closedCount = closedWithPnl.length;
  const winRate = closedCount > 0 ? winningClosed.length / closedCount : 0;
  const avgWin =
    winningClosed.length > 0
      ? winningClosed.reduce((sum: number, r: any) => sum + Number(r.pnl ?? 0), 0) / winningClosed.length
      : 0;
  const avgLoss =
    losingClosed.length > 0
      ? losingClosed.reduce((sum: number, r: any) => sum + Number(r.pnl ?? 0), 0) / losingClosed.length
      : 0;
  const expectancy = closedCount > 0 ? realizedPnl / closedCount : 0;

  const strategyAnalyticsMap = Object.values(
    rows.reduce((acc: Record<string, any>, r: any) => {
      const strategy = String(r.strategy_version ?? "unknown");
      if (!acc[strategy]) {
        acc[strategy] = {
          strategy,
          trade_count: 0,
          closed_count: 0,
          wins: 0,
          losses: 0,
          realized_pnl: 0,
          avg_win: 0,
          avg_loss: 0,
          _win_sum: 0,
          _loss_sum: 0,
        };
      }
      acc[strategy].trade_count += 1;
      const status = String(r.status ?? "");
      const isClosed = ["CLOSED", "STOPPED", "TP1_HIT", "TP2_HIT"].includes(status);
      if (!isClosed) return acc;
      const entry = toNum(r.entry_price);
      const exit = toNum(r.exit_price);
      const shares = toNum(r.shares) ?? 0;
      if (entry == null || exit == null || shares <= 0) return acc;
      const pnl = (exit - entry) * shares;
      acc[strategy].closed_count += 1;
      acc[strategy].realized_pnl += pnl;
      if (pnl > 0) {
        acc[strategy].wins += 1;
        acc[strategy]._win_sum += pnl;
      } else if (pnl < 0) {
        acc[strategy].losses += 1;
        acc[strategy]._loss_sum += pnl;
      }
      return acc;
    }, {})
  ).map((s: any) => ({
    strategy: s.strategy,
    trade_count: s.trade_count,
    win_rate: s.closed_count > 0 ? s.wins / s.closed_count : 0,
    realized_pnl: s.realized_pnl,
    avg_win: s.wins > 0 ? s._win_sum / s.wins : 0,
    avg_loss: s.losses > 0 ? s._loss_sum / s.losses : 0,
  }));
  const strategyOrder = ["v1", "v1_trend_hold", "v1_sector_momentum"];
  const strategyAnalytics = strategyOrder.map((strategy) => {
    const existing = strategyAnalyticsMap.find((s: any) => s.strategy === strategy);
    return (
      existing ?? {
        strategy,
        trade_count: 0,
        win_rate: 0,
        realized_pnl: 0,
        avg_win: 0,
        avg_loss: 0,
      }
    );
  });

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
            <div className="font-semibold">Failed to load paper positions: {paperError.message}</div>
            {missingPaperTable ? (
              <div className="mt-2 text-rose-800">
                Missing table `public.paper_positions`. Apply
                {" "}
                <code>docs/SQL/2026-03-08_paper_execution.sql</code>
                {" "}
                (or
                {" "}
                <code>supabase/migrations/20260308100000_paper_positions.sql</code>
                ).
              </div>
            ) : null}
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

        <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
          <div className="mb-3 text-sm font-semibold text-slate-800">Paper Analytics</div>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3">
              <div className="text-xs text-slate-500">Total paper trades</div>
              <div className="mt-1 text-xl font-semibold">{rows.length}</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3">
              <div className="text-xs text-slate-500">Win rate (closed)</div>
              <div className="mt-1 text-xl font-semibold">{(winRate * 100).toFixed(0)}%</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3">
              <div className="text-xs text-slate-500">Average win</div>
              <div className="mt-1 text-xl font-semibold">{money(avgWin)}</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3">
              <div className="text-xs text-slate-500">Average loss</div>
              <div className="mt-1 text-xl font-semibold">{money(avgLoss)}</div>
            </div>
            <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3">
              <div className="text-xs text-slate-500">Expectancy / closed trade</div>
              <div className="mt-1 text-xl font-semibold">{money(expectancy)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
          <div className="mb-3 text-sm font-semibold text-slate-800">Performance by strategy</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-[#eadfce]">
                  <th className="px-2 py-2">Strategy</th>
                  <th className="px-2 py-2">Trade count</th>
                  <th className="px-2 py-2">Win rate</th>
                  <th className="px-2 py-2">Realized P/L</th>
                  <th className="px-2 py-2">Average win</th>
                  <th className="px-2 py-2">Average loss</th>
                </tr>
              </thead>
              <tbody>
                {strategyAnalytics.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-4 text-slate-500">
                      No strategy analytics yet.
                    </td>
                  </tr>
                ) : null}
                {strategyAnalytics.map((s: any) => (
                  <tr key={s.strategy} className="border-b border-[#f1e9dc]">
                    <td className="px-2 py-2 font-semibold">{s.strategy}</td>
                    <td className="px-2 py-2">{s.trade_count}</td>
                    <td className="px-2 py-2">{(Number(s.win_rate ?? 0) * 100).toFixed(0)}%</td>
                    <td className="px-2 py-2">{money(Number(s.realized_pnl ?? 0))}</td>
                    <td className="px-2 py-2">{money(Number(s.avg_win ?? 0))}</td>
                    <td className="px-2 py-2">{money(Number(s.avg_loss ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <PaperPositionsClient initialRows={rows as any} latestPriceBySymbol={latestPriceBySymbol} />
      </div>
    </AppShell>
  );
}
