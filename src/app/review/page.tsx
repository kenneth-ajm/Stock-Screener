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
            "id,symbol,strategy_version,entry_price,exit_price,shares,quantity,position_size,entry_date,exit_date,created_at,closed_at,entry_fee,exit_fee,exit_reason,notes"
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
      shares,
      entry_date: entryDate ? entryDate.slice(0, 10) : null,
      exit_date: exitDate ? exitDate.slice(0, 10) : null,
      fees: Number.isFinite(fees) ? fees : 0,
      exit_reason: row?.exit_reason ? String(row.exit_reason) : null,
      notes: row?.notes ? String(row.notes) : null,
      holding_days: holdingDays,
      return_pct: returnPct,
      net_pnl: netPnl,
    };
  });

  const realized = closed.reduce((sum: number, row: any) => sum + Number(row.net_pnl ?? 0), 0);
  const wins = closed.filter((row: any) => Number(row.net_pnl ?? 0) > 0).length;
  const losses = closed.filter((row: any) => Number(row.net_pnl ?? 0) < 0).length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  const avgReturn = closed.length > 0 ? closed.reduce((sum: number, row: any) => sum + Number(row.return_pct ?? 0), 0) / closed.length : 0;
  const avgHoldingDays =
    closed.length > 0
      ? closed.reduce((sum: number, row: any) => sum + Number(row.holding_days ?? 0), 0) / closed.length
      : 0;

  return (
    <AppShell currentPath="/review" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
          <p className="text-sm text-slate-600">Closed-trade performance and recent history.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-5">
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
        </div>

        <ReviewClient initialTrades={closed as any} />
      </div>
    </AppShell>
  );
}
