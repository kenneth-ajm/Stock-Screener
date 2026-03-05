type ComputePortfolioMathArgs = {
  supabase: any;
  portfolio_id: string;
};

export type DeployedAndCash = {
  deployed_cost_basis: number;
  estimated_cash: number;
  market_value_optional: number | null;
  open_count: number;
  lots_used: boolean;
  account_size: number;
  cash_balance: number | null;
  cash_available: number;
  cash_source: "manual" | "estimated";
  unknown_open_positions_count: number;
  unknown_examples: Array<{ symbol: string; qty: unknown; entry_price: unknown }>;
  open_lots_count: number;
  open_symbols_count: number;
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

function resolveQty(row: any) {
  return (
    toNum(row?.qty) ??
    toNum(row?.shares) ??
    toNum(row?.quantity) ??
    toNum(row?.position_size)
  );
}

export async function computeDeployedAndCash(opts: ComputePortfolioMathArgs): Promise<DeployedAndCash | null> {
  const supa = opts.supabase as any;
  const portfolioId = String(opts.portfolio_id ?? "").trim();
  if (!portfolioId) return null;

  const { data: portfolio, error: portfolioErr } = await supa
    .from("portfolios")
    .select("id,account_size,cash_balance")
    .eq("id", portfolioId)
    .limit(1)
    .maybeSingle();
  if (portfolioErr) throw portfolioErr;
  if (!portfolio?.id) return null;

  const accountSize = toNum(portfolio.account_size) ?? 0;
  const manualCashBalance = toNum(portfolio.cash_balance);

  // Preferred source of truth: OPEN position lots with entry_price * qty cost basis.
  // Fallback only if lot-style fields are unavailable.
  let lotsUsed = false;
  let openRows: any[] = [];
  const primaryRes = await supa
    .from("portfolio_positions")
    .select("symbol,qty,shares,quantity,position_size,entry_price,status")
    .eq("portfolio_id", portfolioId)
    .eq("status", "OPEN");
  if (primaryRes.error) throw primaryRes.error;
  openRows = Array.isArray(primaryRes.data) ? primaryRes.data : [];
  lotsUsed = openRows.length > 0;

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

    const shares = resolveQty(row);
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

  const estimatedCash = accountSize - deployedCostBasis;
  const cashAvailable = manualCashBalance != null ? manualCashBalance : estimatedCash;
  const cashSource: "manual" | "estimated" = manualCashBalance != null ? "manual" : "estimated";

  if (Math.abs((accountSize - deployedCostBasis) - estimatedCash) > 0.01) {
    console.warn("portfolio math consistency warning", {
      portfolio_id: portfolioId,
      account_size: accountSize,
      deployed_cost_basis: deployedCostBasis,
      estimated_cash: estimatedCash,
    });
  }

  return {
    deployed_cost_basis: deployedCostBasis,
    estimated_cash: estimatedCash,
    market_value_optional: null,
    open_count: rows.length,
    lots_used: lotsUsed,
    account_size: accountSize,
    cash_balance: manualCashBalance ?? null,
    cash_available: cashAvailable,
    cash_source: cashSource,
    unknown_open_positions_count: unknownOpenPositionsCount,
    unknown_examples: unknownExamples,
    open_lots_count: rows.length,
    open_symbols_count: symbolSet.size,
  };
}

export async function computePortfolioMath(opts: ComputePortfolioMathArgs): Promise<PortfolioMath | null> {
  const math = await computeDeployedAndCash(opts);
  if (!math) return null;

  return {
    account_size: math.account_size,
    open_count: math.open_count,
    deployed_cost_basis: math.deployed_cost_basis,
    estimated_cash: math.estimated_cash,
    lots_used: math.lots_used,
    open_lots_count: math.open_lots_count,
    open_symbols_count: math.open_symbols_count,
    unknown_open_positions_count: math.unknown_open_positions_count,
    unknown_examples: math.unknown_examples,
  };
}
