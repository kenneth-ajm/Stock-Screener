import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import MomentumWatchlistClient from "@/app/momentum-watchlist/MomentumWatchlistClient";

export const dynamic = "force-dynamic";

export default async function MomentumWatchlistPage() {
  const { user, portfolios } = await getWorkspaceContext("/momentum-watchlist");

  return (
    <AppShell currentPath="/momentum-watchlist" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-2">
        <div className="inline-flex rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-xs font-semibold text-fuchsia-800">
          1-2 day momentum watchlist
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-[2.1rem]">Fast Momentum</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          A focused daily-data scanner for speculative momentum names, early breakouts, pullback retests, and do-not-chase warnings.
        </p>
      </div>

      <div className="mt-5">
        <MomentumWatchlistClient />
      </div>
    </AppShell>
  );
}
