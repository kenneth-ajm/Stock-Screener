import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { BrokerPositionSnapshot, BrokerReadOnlyResult } from "@/lib/broker/types";

type InternalPositionRow = {
  symbol: string | null;
  shares?: number | null;
  quantity?: number | null;
  position_size?: number | null;
  entry_price?: number | null;
  avg_cost?: number | null;
};

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolveQty(row: InternalPositionRow): number {
  const values = [row.shares, row.quantity, row.position_size];
  for (const value of values) {
    const n = toNum(value);
    if (n != null && n > 0) return n;
  }
  return 0;
}

function normalizeSymbol(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function aggregateInternal(rows: InternalPositionRow[]) {
  const map = new Map<string, { symbol: string; quantity: number; avg_cost: number | null; _costQty: number; _qtyForCost: number }>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    const qty = resolveQty(row);
    if (!(qty > 0)) continue;
    const rawCost = toNum(row.avg_cost) ?? toNum(row.entry_price);
    const existing = map.get(symbol) ?? {
      symbol,
      quantity: 0,
      avg_cost: null,
      _costQty: 0,
      _qtyForCost: 0,
    };
    existing.quantity += qty;
    if (rawCost != null && rawCost > 0) {
      existing._costQty += rawCost * qty;
      existing._qtyForCost += qty;
    }
    map.set(symbol, existing);
  }
  return Array.from(map.values()).map((row) => ({
    symbol: row.symbol,
    quantity: Number(row.quantity.toFixed(6)),
    avg_cost:
      row._qtyForCost > 0 ? Number((row._costQty / row._qtyForCost).toFixed(4)) : null,
  }));
}

function aggregateBroker(rows: BrokerPositionSnapshot[]) {
  const map = new Map<string, { symbol: string; quantity: number; avg_cost: number | null; _costQty: number; _qtyForCost: number }>();
  for (const row of rows ?? []) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    const qty = toNum(row.quantity) ?? 0;
    if (!(qty > 0)) continue;
    const rawCost = toNum(row.average_cost);
    const existing = map.get(symbol) ?? {
      symbol,
      quantity: 0,
      avg_cost: null,
      _costQty: 0,
      _qtyForCost: 0,
    };
    existing.quantity += qty;
    if (rawCost != null && rawCost > 0) {
      existing._costQty += rawCost * qty;
      existing._qtyForCost += qty;
    }
    map.set(symbol, existing);
  }
  return Array.from(map.values()).map((row) => ({
    symbol: row.symbol,
    quantity: Number(row.quantity.toFixed(6)),
    avg_cost:
      row._qtyForCost > 0 ? Number((row._costQty / row._qtyForCost).toFixed(4)) : null,
  }));
}

function latestAsOf(snapshot: BrokerReadOnlyResult): string | null {
  const stamps: string[] = [];
  if (snapshot.account?.as_of) stamps.push(String(snapshot.account.as_of));
  for (const row of snapshot.positions ?? []) {
    if (row?.as_of) stamps.push(String(row.as_of));
  }
  if (stamps.length === 0) return null;
  return stamps.sort().slice(-1)[0] ?? null;
}

function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } }) as any;
}

export async function reconcileBrokerWithPortfolio(opts: {
  supabase: any;
  portfolio_id: string;
  broker_positions: BrokerPositionSnapshot[];
}) {
  const supa = opts.supabase as any;
  const portfolioId = String(opts.portfolio_id ?? "").trim();
  if (!portfolioId) {
    return {
      ok: false as const,
      error: "Missing portfolio_id",
      portfolio_id: null,
      portfolio_open_symbols: 0,
      broker_open_symbols: 0,
      broker_only: [] as string[],
      internal_only: [] as string[],
      quantity_mismatches: [] as Array<{
        symbol: string;
        broker_qty: number;
        internal_qty: number;
        delta_qty: number;
      }>,
      avg_cost_mismatches: [] as Array<{
        symbol: string;
        broker_avg_cost: number;
        internal_avg_cost: number;
        delta_pct: number;
      }>,
      warnings: ["No default portfolio available for reconciliation."],
    };
  }

  const { data, error } = await supa
    .from("portfolio_positions")
    .select("symbol,shares,quantity,position_size,entry_price,avg_cost")
    .eq("portfolio_id", portfolioId)
    .eq("status", "OPEN");
  if (error) throw error;

  const internal = aggregateInternal((data ?? []) as InternalPositionRow[]);
  const broker = aggregateBroker(opts.broker_positions ?? []);
  const internalMap = new Map(internal.map((row) => [row.symbol, row]));
  const brokerMap = new Map(broker.map((row) => [row.symbol, row]));

  const broker_only = broker
    .map((row) => row.symbol)
    .filter((symbol) => !internalMap.has(symbol))
    .sort();
  const internal_only = internal
    .map((row) => row.symbol)
    .filter((symbol) => !brokerMap.has(symbol))
    .sort();

  const quantity_mismatches: Array<{
    symbol: string;
    broker_qty: number;
    internal_qty: number;
    delta_qty: number;
  }> = [];
  const avg_cost_mismatches: Array<{
    symbol: string;
    broker_avg_cost: number;
    internal_avg_cost: number;
    delta_pct: number;
  }> = [];

  for (const [symbol, brokerRow] of brokerMap.entries()) {
    const internalRow = internalMap.get(symbol);
    if (!internalRow) continue;
    const deltaQty = Number((brokerRow.quantity - internalRow.quantity).toFixed(6));
    if (Math.abs(deltaQty) > 0.0001) {
      quantity_mismatches.push({
        symbol,
        broker_qty: brokerRow.quantity,
        internal_qty: internalRow.quantity,
        delta_qty: deltaQty,
      });
    }
    if (
      brokerRow.avg_cost != null &&
      internalRow.avg_cost != null &&
      brokerRow.avg_cost > 0 &&
      internalRow.avg_cost > 0
    ) {
      const deltaPct = Number(
        ((((brokerRow.avg_cost - internalRow.avg_cost) / internalRow.avg_cost) * 100) || 0).toFixed(
          2
        )
      );
      if (Math.abs(deltaPct) >= 2) {
        avg_cost_mismatches.push({
          symbol,
          broker_avg_cost: brokerRow.avg_cost,
          internal_avg_cost: internalRow.avg_cost,
          delta_pct: deltaPct,
        });
      }
    }
  }

  return {
    ok: true as const,
    portfolio_id: portfolioId,
    portfolio_open_symbols: internal.length,
    broker_open_symbols: broker.length,
    broker_only,
    internal_only,
    quantity_mismatches,
    avg_cost_mismatches,
    warnings: [] as string[],
  };
}

export async function persistBrokerSnapshot(opts: {
  user_id: string;
  snapshot: BrokerReadOnlyResult;
  reconciliation: unknown;
}) {
  const supa = serviceRoleClient();
  const userId = String(opts.user_id ?? "").trim();
  if (!userId) throw new Error("Missing user_id");
  const key = `broker_snapshot_last_run:${userId}`;
  const payload = {
    key,
    value: {
      run_at: new Date().toISOString(),
      provider: opts.snapshot.provider,
      mode: opts.snapshot.mode,
      configured: opts.snapshot.configured,
      auth_ok: opts.snapshot.auth_ok,
      connection_ok: opts.snapshot.connection_ok,
      account: opts.snapshot.account,
      positions_count: opts.snapshot.positions_count,
      positions: opts.snapshot.positions,
      latest_broker_as_of: latestAsOf(opts.snapshot),
      warnings: opts.snapshot.warnings,
      errors: opts.snapshot.errors,
      reconciliation: opts.reconciliation,
      safeguards: {
        read_only_only: true,
        execution_enabled: false,
        scanner_influence: false,
        strategy_influence: false,
      },
    },
    updated_at: new Date().toISOString(),
  };
  const { error } = await supa.from("system_status").upsert(payload, { onConflict: "key" });
  if (error) throw error;
  return { key, updated_at: payload.updated_at };
}

