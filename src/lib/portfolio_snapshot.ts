type SnapshotArgs = {
  supabase: any;
  portfolio_id: string;
  include_market_value?: boolean;
};

export type PortfolioSnapshot = {
  portfolio_id: string;
  account_size: number;
  cash_balance: number | null;
  deployed_cost_basis: number;
  estimated_cash: number;
  cash_available: number;
  cash_source: "manual" | "estimated";
  market_value_optional: number | null;
  open_count: number;
  lots_used: boolean;
  open_lots_count: number;
  open_symbols_count: number;
  unknown_open_positions_count: number;
  unknown_examples: Array<{ symbol: string; qty: unknown; entry_price: unknown }>;
  open_rows: Array<{ symbol: string; qty: number | null; entry_price: number | null; contribution: number | null }>;
};

function toNum(v: unknown) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolveQty(row: any) {
  return toNum(row?.shares) ?? toNum(row?.quantity) ?? toNum(row?.position_size) ?? toNum(row?.qty);
}

export async function getPortfolioSnapshot(
  supabase: any,
  portfolio_id: string,
  include_market_value = false
): Promise<PortfolioSnapshot | null> {
  const supa = supabase as any;
  const portfolioId = String(portfolio_id ?? "").trim();
  if (!portfolioId) return null;

  const { data: portfolio, error: pErr } = await supa
    .from("portfolios")
    .select("id,account_size,cash_balance")
    .eq("id", portfolioId)
    .limit(1)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!portfolio?.id) return null;

  const accountSize = toNum(portfolio.account_size) ?? 0;
  const manualCash = toNum(portfolio.cash_balance);

  let lotsUsed = false;
  let rows: any[] = [];

  const primary = await supa
    .from("portfolio_positions")
    .select("symbol,shares,quantity,position_size,entry_price,status")
    .eq("portfolio_id", portfolioId)
    .eq("status", "OPEN");
  if (primary.error) throw primary.error;
  rows = Array.isArray(primary.data) ? primary.data : [];
  lotsUsed = rows.length > 0;

  if (rows.length === 0) {
    const fallbackLots = await supa
      .from("portfolio_lots")
      .select("symbol,qty,entry_price,avg_cost,status")
      .eq("portfolio_id", portfolioId)
      .eq("status", "OPEN");
    if (!fallbackLots.error && Array.isArray(fallbackLots.data) && fallbackLots.data.length > 0) {
      rows = fallbackLots.data.map((row: any) => ({
        symbol: row?.symbol,
        shares: row?.qty,
        quantity: row?.qty,
        position_size: row?.qty,
        entry_price: row?.entry_price ?? row?.avg_cost ?? null,
      }));
      lotsUsed = true;
    }
  }

  let deployed = 0;
  let unknownCount = 0;
  const unknownExamples: Array<{ symbol: string; qty: unknown; entry_price: unknown }> = [];
  const symbolSet = new Set<string>();
  const openRows: Array<{ symbol: string; qty: number | null; entry_price: number | null; contribution: number | null }> = [];

  for (const row of rows) {
    const symbol = String(row?.symbol ?? "").trim().toUpperCase();
    if (symbol) symbolSet.add(symbol);
    const qty = resolveQty(row);
    const entry = toNum(row?.entry_price);
    const contribution = qty != null && entry != null ? qty * entry : null;
    openRows.push({ symbol, qty, entry_price: entry, contribution });
    if (contribution == null) {
      unknownCount += 1;
      if (unknownExamples.length < 5) {
        unknownExamples.push({
          symbol,
          qty: row?.shares ?? row?.quantity ?? row?.position_size ?? row?.qty ?? null,
          entry_price: row?.entry_price ?? null,
        });
      }
      continue;
    }
    deployed += contribution;
  }

  let marketValue: number | null = null;
  if (include_market_value && symbolSet.size > 0) {
    const symbols = Array.from(symbolSet);
    const { data: bars, error: barsErr } = await supa
      .from("price_bars")
      .select("symbol,date,close")
      .in("symbol", symbols)
      .order("symbol", { ascending: true })
      .order("date", { ascending: false });
    if (barsErr) throw barsErr;
    const latestBySymbol = new Map<string, number>();
    for (const bar of bars ?? []) {
      const sym = String((bar as any)?.symbol ?? "").trim().toUpperCase();
      const close = toNum((bar as any)?.close);
      if (!sym || close == null || latestBySymbol.has(sym)) continue;
      latestBySymbol.set(sym, close);
    }
    marketValue = 0;
    for (const row of openRows) {
      if (!row.symbol || row.qty == null || row.qty <= 0) continue;
      const last = latestBySymbol.get(row.symbol);
      if (typeof last === "number" && Number.isFinite(last) && last > 0) {
        marketValue += last * row.qty;
      }
    }
  }

  const estimatedCash = accountSize - deployed;
  const cashAvailable = manualCash != null ? manualCash : estimatedCash;
  const cashSource: "manual" | "estimated" = manualCash != null ? "manual" : "estimated";

  return {
    portfolio_id: portfolioId,
    account_size: accountSize,
    cash_balance: manualCash,
    deployed_cost_basis: deployed,
    estimated_cash: estimatedCash,
    cash_available: cashAvailable,
    cash_source: cashSource,
    market_value_optional: marketValue,
    open_count: rows.length,
    lots_used: lotsUsed,
    open_lots_count: rows.length,
    open_symbols_count: symbolSet.size,
    unknown_open_positions_count: unknownCount,
    unknown_examples: unknownExamples,
    open_rows: openRows,
  };
}
