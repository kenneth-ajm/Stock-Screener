import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getOrRepairDefaultPortfolio } from "@/lib/get_or_repair_default_portfolio";

export async function getWorkspaceContext(nextPath: string) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth?next=${encodeURIComponent(nextPath)}`);

  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id,name,is_default")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const defaultPortfolio = await getOrRepairDefaultPortfolio({
    supabase: supabase as any,
    user_id: user.id,
  });

  return {
    supabase,
    user,
    portfolios: (portfolios ?? []) as Array<{ id: string; name: string | null; is_default?: boolean | null }>,
    defaultPortfolio,
  };
}
