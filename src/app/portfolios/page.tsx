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

export default async function PortfoliosPage() {
  const supabase = await makeSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?next=/portfolios");
  }

  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6 text-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Portfolios</div>
          <div className="text-sm text-slate-600">
            Create multiple investment journeys with different capital and risk settings.
          </div>
        </div>

        <Link
          href="/screener"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 whitespace-nowrap"
        >
          <span aria-hidden="true">←</span>
          Back to Screener
        </Link>
      </div>

      <PortfoliosClient initialPortfolios={portfolios ?? []} />
    </div>
  );
}