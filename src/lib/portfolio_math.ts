import { getPortfolioSnapshot } from "@/lib/portfolio_snapshot";

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

export async function computeDeployedAndCash(opts: ComputePortfolioMathArgs): Promise<DeployedAndCash | null> {
  const snapshot = await getPortfolioSnapshot(opts.supabase, opts.portfolio_id, false);
  if (!snapshot) return null;

  const estimatedCash = snapshot.account_size - snapshot.deployed_cost_basis;
  if (Math.abs(estimatedCash - snapshot.estimated_cash) > 0.01) {
    console.warn("portfolio math consistency warning", {
      portfolio_id: snapshot.portfolio_id,
      account_size: snapshot.account_size,
      deployed_cost_basis: snapshot.deployed_cost_basis,
      estimated_cash: snapshot.estimated_cash,
    });
  }

  return {
    deployed_cost_basis: snapshot.deployed_cost_basis,
    estimated_cash: snapshot.estimated_cash,
    market_value_optional: snapshot.market_value_optional,
    open_count: snapshot.open_count,
    lots_used: snapshot.lots_used,
    account_size: snapshot.account_size,
    cash_balance: snapshot.cash_balance,
    cash_available: snapshot.cash_available,
    cash_source: snapshot.cash_source,
    unknown_open_positions_count: snapshot.unknown_open_positions_count,
    unknown_examples: snapshot.unknown_examples,
    open_lots_count: snapshot.open_lots_count,
    open_symbols_count: snapshot.open_symbols_count,
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
