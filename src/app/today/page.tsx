import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import DailyCockpitClient from "./DailyCockpitClient";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { user, portfolios } = await getWorkspaceContext("/today");

  return (
    <AppShell currentPath="/today" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-2">
        <div className="muted-label">Short-to-medium term · Daily timeframe</div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-[2.2rem]">Daily Cockpit</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          One decision list for new entries, near triggers, and open-position management. Start here before opening the research workspace.
        </p>
      </div>
      <div className="mt-5"><DailyCockpitClient /></div>
    </AppShell>
  );
}
