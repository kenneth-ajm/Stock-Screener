type InternalPositionRow = {
  symbol?: string | null;
  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;
  entry_price?: number | null;
};

type BrokerPositionRow = {
  symbol?: string | null;
  quantity?: number | null;
  average_cost?: number | null;
  market_price?: number | null;
  market_value?: number | null;
};

export type ImportProposal = {
  symbol: string;
  broker_quantity: number;
  broker_average_cost: number | null;
  broker_market_price: number | null;
  suggested_entry_price: number | null;
  status: "ready_for_manual_import" | "needs_manual_entry_price";
  required_manual_fields: string[];
  suggested_payload: {
    symbol: string;
    shares: number;
    entry_price: number | null;
    stop_price: null;
    tp1: null;
    tp2: null;
    strategy_version: null;
    note: string;
  };
};

export type ReconciliationAssistantResult = {
  broker_only_count: number;
  internal_only_count: number;
  matched_count: number;
  proposals: ImportProposal[];
};

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeSymbol(v: unknown) {
  return String(v ?? "").trim().toUpperCase();
}

function resolveQty(row: InternalPositionRow) {
  const values = [row.shares, row.quantity, row.position_size];
  for (const v of values) {
    const n = toNum(v);
    if (n != null && n > 0) return n;
  }
  return 0;
}

function aggregateBroker(rows: BrokerPositionRow[]) {
  const map = new Map<string, {
    symbol: string;
    quantity: number;
    avg_cost: number | null;
    market_price: number | null;
    market_value: number | null;
    _costQty: number;
    _qtyForCost: number;
  }>();

  for (const row of rows ?? []) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    const qty = toNum(row.quantity) ?? 0;
    if (!(qty > 0)) continue;
    const avg = toNum(row.average_cost);
    const mkt = toNum(row.market_price);
    const val = toNum(row.market_value);

    const existing = map.get(symbol) ?? {
      symbol,
      quantity: 0,
      avg_cost: null,
      market_price: null,
      market_value: null,
      _costQty: 0,
      _qtyForCost: 0,
    };

    existing.quantity += qty;
    if (avg != null && avg > 0) {
      existing._costQty += avg * qty;
      existing._qtyForCost += qty;
    }
    if (mkt != null && mkt > 0) existing.market_price = mkt;
    if (val != null && val > 0) {
      existing.market_value = (existing.market_value ?? 0) + val;
    }
    map.set(symbol, existing);
  }

  return Array.from(map.values()).map((row) => ({
    symbol: row.symbol,
    quantity: Number(row.quantity.toFixed(6)),
    avg_cost: row._qtyForCost > 0 ? Number((row._costQty / row._qtyForCost).toFixed(4)) : null,
    market_price: row.market_price,
    market_value: row.market_value != null ? Number(row.market_value.toFixed(2)) : null,
  }));
}

function aggregateInternal(rows: InternalPositionRow[]) {
  const symbols = new Set<string>();
  for (const row of rows ?? []) {
    const symbol = normalizeSymbol(row.symbol);
    const qty = resolveQty(row);
    if (!symbol || !(qty > 0)) continue;
    symbols.add(symbol);
  }
  return symbols;
}

export function buildReconciliationAssistant(opts: {
  broker_positions: BrokerPositionRow[];
  internal_positions: InternalPositionRow[];
}) : ReconciliationAssistantResult {
  const broker = aggregateBroker(opts.broker_positions ?? []);
  const internal = aggregateInternal(opts.internal_positions ?? []);

  const brokerOnly = broker.filter((row) => !internal.has(row.symbol));
  const internalOnlyCount = Array.from(internal).filter((s) => !broker.some((b) => b.symbol === s)).length;
  const matchedCount = broker.length - brokerOnly.length;

  const proposals: ImportProposal[] = brokerOnly.map((row) => {
    const suggestedEntry = row.avg_cost != null && row.avg_cost > 0 ? row.avg_cost : null;
    const status = suggestedEntry != null ? "ready_for_manual_import" : "needs_manual_entry_price";
    const required_manual_fields = ["stop_price", "tp1", "tp2", "strategy_version"];
    if (suggestedEntry == null) required_manual_fields.unshift("entry_price");

    return {
      symbol: row.symbol,
      broker_quantity: row.quantity,
      broker_average_cost: row.avg_cost,
      broker_market_price: row.market_price,
      suggested_entry_price: suggestedEntry,
      status,
      required_manual_fields,
      suggested_payload: {
        symbol: row.symbol,
        shares: Math.max(1, Math.round(row.quantity)),
        entry_price: suggestedEntry,
        stop_price: null,
        tp1: null,
        tp2: null,
        strategy_version: null,
        note: "Proposed from broker read-only reconciliation. Review and confirm manually.",
      },
    };
  });

  return {
    broker_only_count: brokerOnly.length,
    internal_only_count: internalOnlyCount,
    matched_count: Math.max(0, matchedCount),
    proposals,
  };
}
