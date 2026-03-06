import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import BacktestClient from "./BacktestClient";

export const dynamic = "force-dynamic";

export default async function BacktestPage() {
  const { user, portfolios } = await getWorkspaceContext("/backtest");
  return (
    <AppShell currentPath="/backtest" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Backtesting v1</h1>
          <p className="text-sm text-slate-600">Momentum-only historical simulation using stored BUY signals.</p>
        </div>
        <BacktestClient />
      </div>
    </AppShell>
  );
}

