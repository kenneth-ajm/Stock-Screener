import AppShell from "@/components/app-shell";
import IdeasWorkspaceClient from "@/app/ideas/IdeasWorkspaceClient";
import { getBuildMarker } from "@/lib/build_marker";
import { getWorkspaceContext } from "@/lib/workspace_context";

export const dynamic = "force-dynamic";

export default async function SwingPage({
  searchParams,
}: {
  searchParams?: Promise<{ symbol?: string; diag?: string; universe?: string; open_ticket?: string }>;
}) {
  const { user, portfolios } = await getWorkspaceContext("/swing");
  const params = (await searchParams) ?? {};
  const initialSymbol = String(params.symbol ?? "").trim().toUpperCase() || null;
  const diagRaw = String(params.diag ?? "").trim().toLowerCase();
  const openTicketRaw = String(params.open_ticket ?? "").trim().toLowerCase();
  const universeRaw = String(params.universe ?? "").trim().toLowerCase();
  const initialUniverse =
    universeRaw === "midcap_1000" || universeRaw === "liquid_2000" || universeRaw === "growth_1500" || universeRaw === "core_800"
      ? universeRaw
      : "auto";

  return (
    <AppShell currentPath="/swing" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-2">
        <div className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">
          2-7 day swing desk
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-[2.1rem]">This Week</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Breakout, continuation, and pullback ideas from the cached swing scanner.
        </p>
      </div>

      <div className="mt-5">
        <IdeasWorkspaceClient
          initialStrategy="v1"
          initialUniverse={initialUniverse}
          initialSymbol={initialSymbol}
          strategyParamRaw="swing"
          showDiagnostics={diagRaw === "1" || diagRaw === "true"}
          buildMarker={getBuildMarker()}
          pageMarker="swing-2-7d-20260426-a"
          openTicketOnLoad={openTicketRaw === "1" || openTicketRaw === "true"}
          initialManualContext={null}
        />
      </div>
    </AppShell>
  );
}
