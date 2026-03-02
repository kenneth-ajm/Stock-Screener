import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import Link from "next/link";
import PortfoliosClient from "./PortfoliosClient";

export const dynamic = "force-dynamic";

async function makeSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}

type PositionRow = {
  portfolio_id: string;
  status: "OPEN" | "CLOSED" | string;
  entry_price: number | null;
  exit_price: number | null;
  quantity?: number | null;
  shares?: number | null;
};

function resolveQty(p: PositionRow): number {
  const v =
    (typeof p.shares === "number" ? p.shares : null) ??
    (typeof p.quantity === "number" ? p.quantity : null) ??
    0;
  return Number.isFinite(v) ? v : 0;
}

export default async function PortfoliosPage() {
  const supabase = await makeSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?next=/portfolios");

  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const portfolioIds = (portfolios ?? []).map((p: any) => p.id).filter(Boolean);

  let positions: PositionRow[] = [];
  if (portfolioIds.length > 0) {
    const { data: pos } = await supabase
      .from("portfolio_positions")
      .select("portfolio_id,status,entry_price,exit_price,quantity,shares")
      .in("portfolio_id", portfolioIds);

    positions = (pos ?? []) as any;
  }

  const portfoliosWithStats =
    (portfolios ?? []).map((p: any) => {
      const related = positions.filter((x) => x.portfolio_id === p.id);

      const open = related.filter((r) => r.status === "OPEN");
      const closed = related.filter((r) => r.status === "CLOSED");

      const deployed = open.reduce((sum, r) => {
        const qty = resolveQty(r);
        const entry = typeof r.entry_price === "number" ? r.entry_price : 0;
        return sum + entry * qty;
      }, 0);

      const realized = closed.reduce((sum, r) => {
        const qty = resolveQty(r);
        const entry = typeof r.entry_price === "number" ? r.entry_price : 0;
        const exit = typeof r.exit_price === "number" ? r.exit_price : 0;
        return sum + (exit - entry) * qty;
      }, 0);

      return {
        ...p,
        stats: {
          deployed,
          openCount: open.length,
          realized,
        },
      };
    }) ?? [];

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6 text-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Portfolios</div>
          <div className="text-sm text-slate-600">
            Click a row to open it. Your <span className="font-medium text-slate-900">Active</span> portfolio is what the
            Screener uses.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/portfolio?manualAdd=1"
            className="select-none inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 whitespace-nowrap"
          >
            + Add Existing Holding
          </Link>

          <Link
            href="/portfolio"
            className="select-none inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 whitespace-nowrap"
          >
            Open Dashboard
          </Link>

          <Link
            href="/screener"
            className="select-none inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 whitespace-nowrap"
          >
            <span aria-hidden="true">←</span>
            Back to Screener
          </Link>
        </div>
      </div>

      <PortfoliosClient initialPortfolios={portfoliosWithStats as any} />
    </div>
  );
}