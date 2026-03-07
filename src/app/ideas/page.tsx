import AppShell from "@/components/app-shell";
import IdeasWorkspaceClient from "./IdeasWorkspaceClient";
import { getWorkspaceContext } from "@/lib/workspace_context";
import { getBuildMarker } from "@/lib/build_marker";

export const dynamic = "force-dynamic";
const IDEAS_PAGE_MARKER = "ideas-canonical-20260308-a";

function normalizeIdeasStrategy(input: string | null | undefined) {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "v1_trend_hold" || raw === "trend") return "v1_trend_hold";
  if (raw === "v1_sector_momentum" || raw === "sector") return "v1_sector_momentum";
  if (raw === "v2_core_momentum" || raw === "momentum" || raw === "core" || raw === "swing" || raw === "")
    return "v2_core_momentum";
  return "v2_core_momentum";
}

export default async function IdeasPage({
  searchParams,
}: {
  searchParams?: Promise<{ strategy?: string; symbol?: string; diag?: string }>;
}) {
  const { user, portfolios } = await getWorkspaceContext("/ideas");
  const params = (await searchParams) ?? {};
  const initialStrategy = normalizeIdeasStrategy(params.strategy ?? "v2_core_momentum");
  const strategyParamRaw = String(params.strategy ?? "").trim() || null;
  const initialSymbol = String(params.symbol ?? "").trim().toUpperCase() || null;
  const diagRaw = String(params.diag ?? "").trim().toLowerCase();
  const showDiagnostics = diagRaw === "1" || diagRaw === "true";
  const buildMarker = getBuildMarker();

  return (
    <AppShell currentPath="/ideas" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.1rem]">Ideas</h1>
        <p className="text-sm leading-6 text-slate-600">Scanner workspace with strategy tabs and a right-side trade ticket.</p>
      </div>
      <div className="mt-4">
        <IdeasWorkspaceClient
          initialStrategy={initialStrategy}
          initialSymbol={initialSymbol}
          strategyParamRaw={strategyParamRaw}
          showDiagnostics={showDiagnostics}
          buildMarker={buildMarker}
          pageMarker={IDEAS_PAGE_MARKER}
        />
      </div>
    </AppShell>
  );
}
