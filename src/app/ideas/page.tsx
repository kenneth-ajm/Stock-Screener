import AppShell from "@/components/app-shell";
import IdeasWorkspaceClient from "./IdeasWorkspaceClient";
import { getWorkspaceContext } from "@/lib/workspace_context";

export const dynamic = "force-dynamic";

export default async function IdeasPage({
  searchParams,
}: {
  searchParams?: Promise<{ strategy?: string; symbol?: string }>;
}) {
  const { user, portfolios } = await getWorkspaceContext("/ideas");
  const params = (await searchParams) ?? {};
  const strategy = String(params.strategy ?? "v2_core_momentum").trim().toLowerCase();
  const initialStrategy =
    strategy === "v1_trend_hold" || strategy === "trend"
      ? "v1_trend_hold"
      : "v2_core_momentum";
  const initialSymbol = String(params.symbol ?? "").trim().toUpperCase() || null;

  return (
    <AppShell currentPath="/ideas" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Ideas</h1>
        <p className="text-sm text-slate-600">Scanner workspace with strategy tabs and a right-side trade ticket.</p>
      </div>
      <div className="mt-4">
        <IdeasWorkspaceClient initialStrategy={initialStrategy} initialSymbol={initialSymbol} />
      </div>
    </AppShell>
  );
}
