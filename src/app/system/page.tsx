import Link from "next/link";
import AppShell from "@/components/app-shell";
import UtilitiesClient from "@/app/screener/UtilitiesClient";
import { getWorkspaceContext } from "@/lib/workspace_context";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const { supabase, user, portfolios } = await getWorkspaceContext("/system");
  let autopilotStatus: { updated_at?: string | null; value?: any } | null = null;
  try {
    const { data } = await supabase
      .from("system_status")
      .select("updated_at,value")
      .eq("key", "daily_autopilot_core_800")
      .maybeSingle();
    autopilotStatus = data ? { updated_at: data.updated_at ?? null, value: data.value ?? null } : null;
  } catch {
    autopilotStatus = null;
  }

  return (
    <AppShell currentPath="/system" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">System</h1>
          <p className="text-sm text-slate-600">Admin and maintenance tools. Hidden from daily workflow.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/diagnostics" className="rounded-xl border border-[#e8dcc8] bg-[#fffaf2] px-3 py-2">
            Diagnostics
          </Link>
          <Link href="/screener" className="rounded-xl border border-[#e8dcc8] bg-[#fffaf2] px-3 py-2">
            Legacy Screener
          </Link>
          <Link href="/portfolio" className="rounded-xl border border-[#e8dcc8] bg-[#fffaf2] px-3 py-2">
            Legacy Portfolio
          </Link>
        </div>

        <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
          <UtilitiesClient
            universeSlug="core_800"
            strategyVersion="v2_core_momentum"
            strategyLabel="Momentum Swing"
            autopilotStatus={autopilotStatus as any}
          />
        </div>
      </div>
    </AppShell>
  );
}
