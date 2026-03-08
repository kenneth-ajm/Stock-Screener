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

const CLOSED_STATUSES = new Set(["CLOSED", "STOPPED", "TP1_HIT", "TP2_HIT"]);

function buildPerformanceRows(items: Array<any>, keyField: string) {
  const grouped = Object.values(
    items.reduce((acc: Record<string, any>, r: any) => {
      const key = String(r?.[keyField] ?? "unknown");
      if (!acc[key]) {
        acc[key] = {
          key,
          trade_count: 0,
          closed_count: 0,
          wins: 0,
          losses: 0,
          realized_pnl: 0,
          _win_sum: 0,
          _loss_sum: 0,
        };
      }
      acc[key].trade_count += 1;

      const status = String(r?.status ?? "");
      if (!CLOSED_STATUSES.has(status)) return acc;

      const entry = toNum(r?.entry_price);
      const exit = toNum(r?.exit_price);
      const shares = toNum(r?.shares) ?? 0;
      if (entry == null || exit == null || shares <= 0) return acc;

      const pnl = (exit - entry) * shares;
      acc[key].closed_count += 1;
      acc[key].realized_pnl += pnl;
      if (pnl > 0) {
        acc[key].wins += 1;
        acc[key]._win_sum += pnl;
      } else if (pnl < 0) {
        acc[key].losses += 1;
        acc[key]._loss_sum += pnl;
      }
      return acc;
    }, {})
  );

  return grouped.map((g: any) => ({
    key: g.key,
    trade_count: g.trade_count,
    win_rate: g.closed_count > 0 ? g.wins / g.closed_count : 0,
    realized_pnl: g.realized_pnl,
    avg_win: g.wins > 0 ? g._win_sum / g.wins : 0,
    avg_loss: g.losses > 0 ? g._loss_sum / g.losses : 0,
  }));
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

  const openRows = rows.filter((r: any) => !CLOSED_STATUSES.has(String(r.status ?? "")));
  const closedRows = rows.filter((r: any) => CLOSED_STATUSES.has(String(r.status ?? "")));

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

  const strategyAnalyticsMap = buildPerformanceRows(rows, "strategy_version").map((s: any) => ({
    strategy: s.key,
    trade_count: s.trade_count,
    win_rate: s.win_rate,
    realized_pnl: s.realized_pnl,
    avg_win: s.avg_win,
    avg_loss: s.avg_loss,
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

  const universeBySymbolStrategy: Record<string, string> = {};
  if (rows.length > 0) {
    const scanSymbols = Array.from(
      new Set(rows.map((r: any) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean))
    );
    const scanStrategies = Array.from(
      new Set(rows.map((r: any) => String(r.strategy_version ?? "").trim()).filter(Boolean))
    );
    if (scanSymbols.length > 0 && scanStrategies.length > 0) {
      const { data: scanRows } = await supabase
        .from("daily_scans")
        .select("symbol,strategy_version,universe_slug,date")
        .in("symbol", scanSymbols)
        .in("strategy_version", scanStrategies)
        .order("date", { ascending: false })
        .limit(5000);
      for (const s of scanRows ?? []) {
        const sym = String((s as any)?.symbol ?? "").trim().toUpperCase();
        const strat = String((s as any)?.strategy_version ?? "").trim();
        const universe = String((s as any)?.universe_slug ?? "").trim();
        if (!sym || !strat || !universe) continue;
        const key = `${sym}::${strat}`;
        if (!universeBySymbolStrategy[key]) universeBySymbolStrategy[key] = universe;
      }
    }
  }

  const rowsWithUniverse = rows.map((r: any) => {
    const sym = String(r.symbol ?? "").trim().toUpperCase();
    const strat = String(r.strategy_version ?? "").trim();
    const key = `${sym}::${strat}`;
    return {
      ...r,
      universe_slug: universeBySymbolStrategy[key] ?? "unknown",
    };
  });

  const universeAnalyticsMap = buildPerformanceRows(rowsWithUniverse, "universe_slug").map((u: any) => ({
    universe: u.key,
    trade_count: u.trade_count,
    win_rate: u.win_rate,
    realized_pnl: u.realized_pnl,
    avg_win: u.avg_win,
    avg_loss: u.avg_loss,
  }));
  const universeOrder = ["liquid_2000", "midcap_1000", "core_800", "growth_1500", "unknown"];
  const orderedUniverse = [
    ...universeOrder,
    ...universeAnalyticsMap
      .map((u: any) => String(u.universe))
      .filter((u: string) => !universeOrder.includes(u)),
  ];
  const universeAnalytics = orderedUniverse
    .filter((u, idx) => orderedUniverse.indexOf(u) === idx)
    .map((universe) => {
      const existing = universeAnalyticsMap.find((u: any) => u.universe === universe);
      return (
        existing ?? {
          universe,
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

        <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
          <div className="mb-1 text-sm font-semibold text-slate-800">Performance by universe</div>
          <div className="mb-3 text-xs text-slate-500">
            Inferred from latest matching scan context in <code>daily_scans</code> for each paper position.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-[#eadfce]">
                  <th className="px-2 py-2">Universe</th>
                  <th className="px-2 py-2">Trade count</th>
                  <th className="px-2 py-2">Win rate</th>
                  <th className="px-2 py-2">Realized P/L</th>
                  <th className="px-2 py-2">Average win</th>
                  <th className="px-2 py-2">Average loss</th>
                </tr>
              </thead>
              <tbody>
                {universeAnalytics.map((u: any) => (
                  <tr key={u.universe} className="border-b border-[#f1e9dc]">
                    <td className="px-2 py-2 font-semibold">{u.universe}</td>
                    <td className="px-2 py-2">{u.trade_count}</td>
                    <td className="px-2 py-2">{(Number(u.win_rate ?? 0) * 100).toFixed(0)}%</td>
                    <td className="px-2 py-2">{money(Number(u.realized_pnl ?? 0))}</td>
                    <td className="px-2 py-2">{money(Number(u.avg_win ?? 0))}</td>
                    <td className="px-2 py-2">{money(Number(u.avg_loss ?? 0))}</td>
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
