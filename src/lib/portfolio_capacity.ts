type CapacityArgs = {
  supabase: any;
  userId: string;
};

export type PortfolioCapacity = {
  portfolio_value: number;
  cash_available: number;
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
  const { data: portfolio, error: pErr } = await supa
    .from("portfolios")
    .select("id,account_size,risk_per_trade,max_positions")
    .eq("user_id", opts.userId)
    .eq("is_default", true)
    .maybeSingle();

  if (pErr || !portfolio?.id) return null;

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
    const entry = toNum(row.entry_price, 0);
    const shares = toNum(row.shares, 0);
    return sum + entry * shares;
  }, 0);

  const cashApprox = portfolioValue > 0 ? portfolioValue - deployed : 0;
  const cashAvailable =
    Number.isFinite(cashApprox) && cashApprox >= 0
      ? cashApprox
      : portfolioValue > 0
        ? portfolioValue
        : 0;

  return {
    portfolio_value: portfolioValue,
    cash_available: cashAvailable,
    open_positions_count: openCount,
    max_positions: maxPositions,
    slots_left: Math.max(0, maxPositions - openCount),
    risk_per_trade: riskPerTrade,
  };
}

