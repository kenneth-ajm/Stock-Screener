type ComputePortfolioMathArgs = {
  supabase: any;
  portfolio_id: string;
};

export type PortfolioMath = {
  account_size: number;
  open_count: number;
  deployed_cost_basis: number;
  estimated_cash: number;
  unknown_open_positions_count: number;
  unknown_examples: Array<{ symbol: string; shares: unknown; entry_price: unknown }>;
};

function toNum(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function computePortfolioMath(opts: ComputePortfolioMathArgs): Promise<PortfolioMath | null> {
  const supa = opts.supabase as any;
  const portfolioId = String(opts.portfolio_id ?? "").trim();
  if (!portfolioId) return null;

  const { data: portfolio, error: portfolioErr } = await supa
    .from("portfolios")
    .select("id,account_size")
    .eq("id", portfolioId)
    .limit(1)
    .maybeSingle();
  if (portfolioErr) throw portfolioErr;
  if (!portfolio?.id) return null;

  const accountSize = toNum(portfolio.account_size) ?? 0;

  const { data: openRows, error: openErr } = await supa
    .from("portfolio_positions")
    .select("symbol,shares,entry_price,status")
    .eq("portfolio_id", portfolioId)
    .eq("status", "OPEN");
  if (openErr) throw openErr;

  const rows = Array.isArray(openRows) ? openRows : [];
  let deployedCostBasis = 0;
  let unknownOpenPositionsCount = 0;
  const unknownExamples: Array<{ symbol: string; shares: unknown; entry_price: unknown }> = [];

  for (const row of rows) {
    const shares = toNum(row?.shares);
    const entryPrice = toNum(row?.entry_price);
    if (shares == null || entryPrice == null) {
      unknownOpenPositionsCount += 1;
      if (unknownExamples.length < 5) {
        unknownExamples.push({
          symbol: String(row?.symbol ?? ""),
          shares: row?.shares ?? null,
          entry_price: row?.entry_price ?? null,
        });
      }
      continue;
    }
    deployedCostBasis += shares * entryPrice;
  }

  return {
    account_size: accountSize,
    open_count: rows.length,
    deployed_cost_basis: deployedCostBasis,
    estimated_cash: accountSize - deployedCostBasis,
    unknown_open_positions_count: unknownOpenPositionsCount,
    unknown_examples: unknownExamples,
  };
}
