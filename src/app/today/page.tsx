import AppShell from "@/components/app-shell";
import IdeasWorkspaceClient from "@/app/ideas/IdeasWorkspaceClient";
import { getBuildMarker } from "@/lib/build_marker";
import { getWorkspaceContext } from "@/lib/workspace_context";

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: {
  searchParams?: Promise<{ symbol?: string; diag?: string; open_ticket?: string }>;
}) {
  const { user, portfolios } = await getWorkspaceContext("/today");
  const params = (await searchParams) ?? {};
  const initialSymbol = String(params.symbol ?? "").trim().toUpperCase() || null;
  const diagRaw = String(params.diag ?? "").trim().toLowerCase();
  const openTicketRaw = String(params.open_ticket ?? "").trim().toLowerCase();

  return (
    <AppShell currentPath="/today" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-2">
        <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
          Daily-bar same-day watchlist
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-[2.1rem]">Today</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Short-term candidates from cached daily bars, focused on buy-ready and near-trigger momentum setups.
        </p>
      </div>

      <div className="mt-5">
        <IdeasWorkspaceClient
          initialStrategy="tactical_momentum"
          initialUniverse="auto"
          initialSymbol={initialSymbol}
          strategyParamRaw="tactical_momentum"
          showDiagnostics={diagRaw === "1" || diagRaw === "true"}
          buildMarker={getBuildMarker()}
          pageMarker="today-watchlist-20260426-a"
          openTicketOnLoad={openTicketRaw === "1" || openTicketRaw === "true"}
          initialManualContext={null}
        />
      </div>
    </AppShell>
  );
}
