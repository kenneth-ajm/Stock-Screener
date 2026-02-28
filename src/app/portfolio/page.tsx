import PortfolioClient from "./portfolioClient";
import { supabaseServer } from "@/lib/supabase/server";

export default async function PortfolioPage() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();

  const user = auth.user;
  if (!user) return null;

  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id, name, account_currency, account_size, risk_per_trade, max_positions, is_default, created_at")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Portfolios</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Each portfolio is its own “investment journey” with separate budget + risk rules.
        </p>
      </div>

      <PortfolioClient initialPortfolios={portfolios ?? []} />
    </div>
  );
}