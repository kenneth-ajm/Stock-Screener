import { getOrRepairDefaultPortfolio } from "@/lib/get_or_repair_default_portfolio";

type CapacityArgs = {
  supabase: any;
  userId: string;
};

export type PortfolioCapacity = {
  portfolio_id: string;
  portfolio_value: number;
  deployed_value: number;
  cash_available: number;
  cash_source: "manual" | "estimated";
  cash_updated_at: string | null;
  open_positions_count: number;
  max_positions: number;
  slots_left: number;
  risk_per_trade: number;
};

function toNum(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getActivePortfolioCapacity(opts: CapacityArgs): Promise<PortfolioCapacity | null> {
  const supa = opts.supabase as any;
  const portfolio = await getOrRepairDefaultPortfolio({
    supabase: supa,
    user_id: opts.userId,
  });
  if (!portfolio?.id) return null;

  const portfolioValue = toNum(portfolio.account_size, 0);
  const riskPerTrade = toNum(portfolio.risk_per_trade, 0.02);
  const maxPositions = Math.max(1, Math.floor(toNum(portfolio.max_positions, 5)));

  const { data: openRows, error: openErr } = await supa
    .from("portfolio_positions")
    .select("entry_price,shares")
    .eq("user_id", opts.userId)
    .eq("portfolio_id", portfolio.id)
    .eq("status", "OPEN");
  if (openErr) return null;

  const openPositions = Array.isArray(openRows) ? openRows : [];
  const openCount = openPositions.length;
  const deployed = openPositions.reduce((sum: number, row: any) => {
    if (row?.entry_price == null || row?.shares == null) return sum;
    const entry = toNum(row.entry_price, NaN);
    const shares = toNum(row.shares, NaN);
    if (!Number.isFinite(entry) || !Number.isFinite(shares)) return sum;
    return sum + entry * shares;
  }, 0);

  const cashApprox = portfolioValue > 0 ? portfolioValue - deployed : 0;
  const hasManualCash =
    portfolio?.cash_balance != null && Number.isFinite(Number(portfolio.cash_balance));
  const manualCash = hasManualCash ? Number(portfolio.cash_balance) : null;
  const estimatedCash =
    Number.isFinite(cashApprox) && cashApprox >= 0
      ? cashApprox
      : portfolioValue > 0
        ? portfolioValue
        : 0;
  const cashAvailable = hasManualCash ? Math.max(0, manualCash as number) : estimatedCash;
  const cashSource = hasManualCash ? "manual" : "estimated";

  return {
    portfolio_id: String(portfolio.id),
    portfolio_value: portfolioValue,
    deployed_value: deployed,
    cash_available: cashAvailable,
    cash_source: cashSource,
    cash_updated_at: portfolio?.cash_updated_at ? String(portfolio.cash_updated_at) : null,
    open_positions_count: openCount,
    max_positions: maxPositions,
    slots_left: Math.max(0, maxPositions - openCount),
    risk_per_trade: riskPerTrade,
  };
}
