import AppShell from "@/components/app-shell";
import IdeasWorkspaceClient from "./IdeasWorkspaceClient";
import { getWorkspaceContext } from "@/lib/workspace_context";
import { getBuildMarker } from "@/lib/build_marker";

export const dynamic = "force-dynamic";
const IDEAS_PAGE_MARKER = "ideas-canonical-20260308-a";

function normalizeIdeasStrategy(input: string | null | undefined) {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "quality_dip" || raw === "quality" || raw === "dip") return "quality_dip";
  if (raw === "tactical_momentum" || raw === "tactical" || raw === "q" || raw === "qstyle") return "tactical_momentum";
  if (raw === "v1_trend_hold" || raw === "trend") return "v1_trend_hold";
  if (raw === "v1_sector_momentum" || raw === "sector") return "v1_sector_momentum";
  if (raw === "v1" || raw === "v2_core_momentum" || raw === "momentum" || raw === "core" || raw === "swing" || raw === "")
    return "v1";
  return "v1";
}

export default async function IdeasPage({
  searchParams,
}: {
  searchParams?: Promise<{
    strategy?: string;
    symbol?: string;
    diag?: string;
    universe?: string;
    open_ticket?: string;
    manual_signal?: string;
    manual_confidence?: string;
    manual_entry?: string;
    manual_stop?: string;
    manual_tp1?: string;
    manual_tp2?: string;
    manual_reason_summary?: string;
    manual_scan_date?: string;
    manual_universe_slug?: string;
  }>;
}) {
  const { user, portfolios } = await getWorkspaceContext("/ideas");
  const params = (await searchParams) ?? {};
  const initialStrategy = normalizeIdeasStrategy(params.strategy ?? "v1");
  const strategyParamRaw = String(params.strategy ?? "").trim() || null;
  const initialSymbol = String(params.symbol ?? "").trim().toUpperCase() || null;
  const initialUniverse = (() => {
    const raw = String(params.universe ?? "").trim().toLowerCase();
    if (raw === "auto" || raw === "") return "auto";
    if (raw === "midcap_1000" || raw === "midcap" || raw === "mid") return "midcap_1000";
    if (raw === "liquid_2000" || raw === "liquid") return "liquid_2000";
    if (raw === "growth_1500" || raw === "growth") return "growth_1500";
    if (raw === "core_800" || raw === "core") return "core_800";
    return "auto";
  })();
  const diagRaw = String(params.diag ?? "").trim().toLowerCase();
  const showDiagnostics = diagRaw === "1" || diagRaw === "true";
  const buildMarker = getBuildMarker();
  const openTicketRaw = String(params.open_ticket ?? "").trim().toLowerCase();
  const openTicketOnLoad = openTicketRaw === "1" || openTicketRaw === "true";
  const manualContext = (() => {
    if (!initialSymbol) return null;
    const signalRaw = String(params.manual_signal ?? "").trim().toUpperCase();
    const signal: "BUY" | "WATCH" | "AVOID" | null =
      signalRaw === "BUY" || signalRaw === "WATCH" || signalRaw === "AVOID" ? signalRaw : null;
    const confidence = Number(params.manual_confidence ?? "");
    const entry = Number(params.manual_entry ?? "");
    const stop = Number(params.manual_stop ?? "");
    const tp1 = Number(params.manual_tp1 ?? "");
    const tp2 = Number(params.manual_tp2 ?? "");
    return {
      symbol: initialSymbol,
      signal,
      confidence: Number.isFinite(confidence) ? confidence : null,
      entry: Number.isFinite(entry) ? entry : null,
      stop: Number.isFinite(stop) ? stop : null,
      tp1: Number.isFinite(tp1) ? tp1 : null,
      tp2: Number.isFinite(tp2) ? tp2 : null,
      reason_summary: String(params.manual_reason_summary ?? "").trim() || null,
      source_scan_date: String(params.manual_scan_date ?? "").trim() || null,
      universe_slug: String(params.manual_universe_slug ?? "").trim() || null,
    };
  })();

  return (
    <AppShell currentPath="/ideas" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.1rem]">Strategy Lab</h1>
        <p className="text-sm leading-6 text-slate-600">Strategy-specific views kept separate from the main time-horizon desks.</p>
      </div>
      <div className="mt-4">
        <IdeasWorkspaceClient
          initialStrategy={initialStrategy}
          initialUniverse={initialUniverse}
          initialSymbol={initialSymbol}
          strategyParamRaw={strategyParamRaw}
          showDiagnostics={showDiagnostics}
          buildMarker={buildMarker}
          pageMarker={IDEAS_PAGE_MARKER}
          openTicketOnLoad={openTicketOnLoad}
          initialManualContext={manualContext}
        />
      </div>
    </AppShell>
  );
}
