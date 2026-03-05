import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { supabase, user, portfolios, defaultPortfolio } = await getWorkspaceContext("/review");
  const portfolioId = String(defaultPortfolio?.id ?? "");

  const { data: closedRows } =
    portfolioId
      ? await supabase
          .from("portfolio_positions")
          .select("symbol,entry_price,exit_price,shares,quantity,position_size,entry_fee,exit_fee,closed_at,exit_reason")
          .eq("portfolio_id", portfolioId)
          .eq("status", "CLOSED")
          .order("closed_at", { ascending: false })
          .limit(100)
      : ({ data: [] } as any);
  const closed = closedRows ?? [];

  const realized = closed.reduce((sum: number, row: any) => {
    const qty = Number(row.shares ?? row.quantity ?? row.position_size ?? 0);
    const entry = Number(row.entry_price ?? 0);
    const exit = Number(row.exit_price ?? 0);
    const fees = Number(row.entry_fee ?? 0) + Number(row.exit_fee ?? 0);
    if (!(qty > 0) || !(entry > 0) || !Number.isFinite(exit)) return sum;
    return sum + (exit - entry) * qty - fees;
  }, 0);
  const wins = closed.filter((row: any) => {
    const qty = Number(row.shares ?? row.quantity ?? row.position_size ?? 0);
    const entry = Number(row.entry_price ?? 0);
    const exit = Number(row.exit_price ?? 0);
    const fees = Number(row.entry_fee ?? 0) + Number(row.exit_fee ?? 0);
    return qty > 0 && entry > 0 && exit > 0 && (exit - entry) * qty - fees > 0;
  }).length;
  const losses = closed.filter((row: any) => {
    const qty = Number(row.shares ?? row.quantity ?? row.position_size ?? 0);
    const entry = Number(row.entry_price ?? 0);
    const exit = Number(row.exit_price ?? 0);
    const fees = Number(row.entry_fee ?? 0) + Number(row.exit_fee ?? 0);
    return qty > 0 && entry > 0 && exit > 0 && (exit - entry) * qty - fees < 0;
  }).length;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;

  return (
    <AppShell currentPath="/review" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
          <p className="text-sm text-slate-600">Closed-trade performance and recent history.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Realized P/L</div>
            <div className="mt-1 text-2xl font-semibold">{money(realized)}</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Win rate</div>
            <div className="mt-1 text-2xl font-semibold">{(winRate * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
            <div className="text-xs text-slate-500">Closed trades</div>
            <div className="mt-1 text-2xl font-semibold">{closed.length}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#e8dcc8] bg-[#fffaf2]">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-[#e8dcc8]">
                <th className="p-3">Symbol</th>
                <th className="p-3">Entry</th>
                <th className="p-3">Exit</th>
                <th className="p-3">Qty</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Closed</th>
              </tr>
            </thead>
            <tbody>
              {closed.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={6}>
                    No closed positions yet.
                  </td>
                </tr>
              ) : (
                closed.map((row: any, idx: number) => (
                  <tr key={`${row.symbol}-${idx}`} className="border-b border-[#efe5d6]">
                    <td className="p-3 font-medium">{String(row.symbol ?? "").trim().toUpperCase()}</td>
                    <td className="p-3">{money(row.entry_price)}</td>
                    <td className="p-3">{money(row.exit_price)}</td>
                    <td className="p-3">{Math.round(Number(row.shares ?? row.quantity ?? row.position_size ?? 0) || 0)}</td>
                    <td className="p-3">{row.exit_reason ?? "—"}</td>
                    <td className="p-3">{row.closed_at ? String(row.closed_at).slice(0, 10) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
