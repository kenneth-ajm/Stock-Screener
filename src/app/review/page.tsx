import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import ReviewClient from "@/app/review/ReviewClient";

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function resolveShares(row: any) {
  const n = Number(row?.shares ?? row?.quantity ?? row?.position_size ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function dateOnly(input: string | null | undefined) {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function diffDays(start: string | null | undefined, end: string | null | undefined) {
  const s = dateOnly(start);
  const e = dateOnly(end);
  if (!s || !e) return null;
  const ms = e.getTime() - s.getTime();
  return ms >= 0 ? Math.round(ms / (24 * 60 * 60 * 1000)) : null;
}

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { supabase, user, portfolios, defaultPortfolio } = await getWorkspaceContext("/review");
  const portfolioId = String(defaultPortfolio?.id ?? "");

  const { data: closedRows } =
    portfolioId
      ? await supabase
          .from("portfolio_positions")
          .select(
            "id,symbol,strategy_version,entry_price,exit_price,stop_price,shares,quantity,position_size,entry_date,exit_date,created_at,closed_at,entry_fee,exit_fee,exit_reason,notes"
          )
          .eq("portfolio_id", portfolioId)
          .eq("status", "CLOSED")
          .order("closed_at", { ascending: false })
          .limit(300)
      : ({ data: [] } as any);
  const closed = (closedRows ?? []).map((row: any) => {
    const symbol = String(row?.symbol ?? "").trim().toUpperCase();
    const shares = resolveShares(row);
    const entry = Number(row?.entry_price ?? 0);
    const exit = Number(row?.exit_price ?? 0);
    const fees = Number(row?.entry_fee ?? 0) + Number(row?.exit_fee ?? 0);
    const entryDate = (row?.entry_date ?? row?.created_at ?? null) ? String(row?.entry_date ?? row?.created_at) : null;
    const exitDate = (row?.exit_date ?? row?.closed_at ?? null) ? String(row?.exit_date ?? row?.closed_at) : null;
    const returnPct = entry > 0 && Number.isFinite(exit) ? ((exit - entry) / entry) * 100 : null;
    const netPnl =
      shares > 0 && entry > 0 && Number.isFinite(exit) ? (exit - entry) * shares - (Number.isFinite(fees) ? fees : 0) : null;
    const holdingDays = diffDays(entryDate, exitDate);
    return {
      id: String(row?.id ?? ""),
      symbol,
      strategy: row?.strategy_version ? String(row.strategy_version) : null,
      entry_price: entry,
      exit_price: exit,
      stop_price: Number(row?.stop_price ?? 0) > 0 ? Number(row?.stop_price) : null,
      shares,
      entry_date: entryDate ? entryDate.slice(0, 10) : null,
      exit_date: exitDate ? exitDate.slice(0, 10) : null,
      fees: Number.isFinite(fees) ? fees : 0,
      exit_reason: row?.exit_reason ? String(row.exit_reason) : null,
      notes: row?.notes ? String(row.notes) : null,
      holding_days: holdingDays,
      return_pct: returnPct,
      net_pnl: netPnl,
      r_multiple:
        entry > 0 &&
        Number.isFinite(exit) &&
        Number(row?.stop_price ?? 0) > 0 &&
        entry > Number(row?.stop_price)
          ? (exit - entry) / (entry - Number(row?.stop_price))
          : null,
    };
  });

  const realized = closed.reduce((sum: number, row: any) => sum + Number(row.net_pnl ?? 0), 0);
  const winningRows = closed.filter((row: any) => Number(row.net_pnl ?? 0) > 0);
  const losingRows = closed.filter((row: any) => Number(row.net_pnl ?? 0) < 0);
  const wins = winningRows.length;
  const losses = losingRows.length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  const avgReturn = closed.length > 0 ? closed.reduce((sum: number, row: any) => sum + Number(row.return_pct ?? 0), 0) / closed.length : 0;
  const avgHoldingDays =
    closed.length > 0
      ? closed.reduce((sum: number, row: any) => sum + Number(row.holding_days ?? 0), 0) / closed.length
      : 0;
  const avgWin = wins > 0 ? winningRows.reduce((sum: number, row: any) => sum + Number(row.net_pnl ?? 0), 0) / wins : 0;
  const avgLoss = losses > 0 ? losingRows.reduce((sum: number, row: any) => sum + Number(row.net_pnl ?? 0), 0) / losses : 0;
  const grossWin = winningRows.reduce((sum: number, row: any) => sum + Number(row.net_pnl ?? 0), 0);
  const grossLossAbs = Math.abs(losingRows.reduce((sum: number, row: any) => sum + Number(row.net_pnl ?? 0), 0));
  const profitFactor = grossLossAbs > 0 ? grossWin / grossLossAbs : null;
  const expectancy = closed.length > 0 ? realized / closed.length : 0;

  const strategyStats = Object.values(
    closed.reduce((acc: Record<string, any>, row: any) => {
      const strategy = String(row.strategy ?? "unknown");
      if (!acc[strategy]) {
        acc[strategy] = {
          strategy,
          trades: 0,
          wins: 0,
          losses: 0,
          pnl: 0,
        };
      }
      const pnl = Number(row.net_pnl ?? 0);
      acc[strategy].trades += 1;
      acc[strategy].pnl += pnl;
      if (pnl > 0) acc[strategy].wins += 1;
      if (pnl < 0) acc[strategy].losses += 1;
      return acc;
    }, {})
  ).map((s: any) => ({
    ...s,
    win_rate: s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0,
  }));

  return (
    <AppShell currentPath="/review" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
          <p className="text-sm text-slate-600">Closed-trade performance and recent history.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-8">
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Closed trades</div>
            <div className="mt-1 text-2xl font-semibold">{closed.length}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Win rate</div>
            <div className="mt-1 text-2xl font-semibold">{(winRate * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Average return</div>
            <div className="mt-1 text-2xl font-semibold">{avgReturn.toFixed(1)}%</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Average holding days</div>
            <div className="mt-1 text-2xl font-semibold">{avgHoldingDays.toFixed(1)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Total realized P/L</div>
            <div className="mt-1 text-2xl font-semibold">{money(realized)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Avg win</div>
            <div className="mt-1 text-2xl font-semibold">{money(avgWin)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Avg loss</div>
            <div className="mt-1 text-2xl font-semibold">{money(avgLoss)}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Profit factor</div>
            <div className="mt-1 text-2xl font-semibold">{typeof profitFactor === "number" ? profitFactor.toFixed(2) : "—"}</div>
          </div>
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="text-xs text-slate-500">Expectancy / trade</div>
            <div className="mt-1 text-2xl font-semibold">{money(expectancy)}</div>
          </div>
        </div>

        {strategyStats.length > 0 ? (
          <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
            <div className="mb-2 text-sm font-semibold text-slate-800">By strategy</div>
            <div className="grid gap-2 md:grid-cols-3">
              {strategyStats.map((s: any) => (
                <div key={s.strategy} className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3 text-xs text-slate-700">
                  <div className="text-sm font-semibold text-slate-900">{s.strategy}</div>
                  <div>Trades: {s.trades}</div>
                  <div>Win rate: {(s.win_rate * 100).toFixed(0)}%</div>
                  <div>Net P/L: {money(s.pnl)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <ReviewClient initialTrades={closed as any} />
      </div>
    </AppShell>
  );
}
