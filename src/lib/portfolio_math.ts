type ComputePortfolioMathArgs = {
  supabase: any;
  portfolio_id: string;
};

export type PortfolioMath = {
  account_size: number;
  open_count: number;
  deployed_cost_basis: number;
  estimated_cash: number;
  lots_used: boolean;
  open_lots_count: number;
  open_symbols_count: number;
  unknown_open_positions_count: number;
  unknown_examples: Array<{ symbol: string; qty: unknown; entry_price: unknown }>;
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

  // Preferred source of truth: OPEN position lots with entry_price * qty cost basis.
  // Fallback only if lot-style fields are unavailable.
  let lotsUsed = false;
  let openRows: any[] = [];
  const primaryRes = await supa
    .from("portfolio_positions")
    .select("symbol,shares,quantity,position_size,entry_price,status")
    .eq("portfolio_id", portfolioId)
    .eq("status", "OPEN");
  if (primaryRes.error) throw primaryRes.error;
  openRows = Array.isArray(primaryRes.data) ? primaryRes.data : [];
  lotsUsed = true;

  // Optional fallback path if a separate lots table exists and primary rows are empty.
  if (openRows.length === 0) {
    const lotsRes = await supa
      .from("portfolio_lots")
      .select("symbol,qty,entry_price,avg_cost,status")
      .eq("portfolio_id", portfolioId)
      .eq("status", "OPEN");
    if (!lotsRes.error && Array.isArray(lotsRes.data) && lotsRes.data.length > 0) {
      openRows = lotsRes.data.map((row: any) => ({
        symbol: row?.symbol,
        shares: row?.qty,
        quantity: row?.qty,
        position_size: row?.qty,
        entry_price: row?.entry_price ?? row?.avg_cost ?? null,
      }));
      lotsUsed = true;
    }
  }

  const rows = Array.isArray(openRows) ? openRows : [];
  let deployedCostBasis = 0;
  let unknownOpenPositionsCount = 0;
  const unknownExamples: Array<{ symbol: string; qty: unknown; entry_price: unknown }> = [];
  const symbolSet = new Set<string>();

  for (const row of rows) {
    const symbol = String(row?.symbol ?? "").toUpperCase().trim();
    if (symbol) symbolSet.add(symbol);

    const shares =
      toNum(row?.shares) ??
      toNum(row?.quantity) ??
      toNum(row?.position_size);
    const entryPrice = toNum(row?.entry_price);
    if (shares == null || entryPrice == null) {
      unknownOpenPositionsCount += 1;
      if (unknownExamples.length < 5) {
        unknownExamples.push({
          symbol: String(row?.symbol ?? ""),
          qty: row?.shares ?? row?.quantity ?? row?.position_size ?? row?.qty ?? null,
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
    lots_used: lotsUsed,
    open_lots_count: rows.length,
    open_symbols_count: symbolSet.size,
    unknown_open_positions_count: unknownOpenPositionsCount,
    unknown_examples: unknownExamples,
  };
}
