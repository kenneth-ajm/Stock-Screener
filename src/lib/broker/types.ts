export type BrokerProvider = "tiger";

export type BrokerAccountSnapshot = {
  account_id: string;
  currency: string;
  cash_available: number | null;
  equity: number | null;
  buying_power: number | null;
  as_of: string;
  source: "broker_api" | "stub";
};

export type BrokerPositionSnapshot = {
  symbol: string;
  quantity: number;
  average_cost: number | null;
  market_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  as_of: string;
  source: "broker_api" | "stub";
};

export type BrokerReadOnlyResult = {
  ok: boolean;
  provider: BrokerProvider;
  mode: "read_only_scaffold" | "read_only_live";
  configured: boolean;
  auth_ok: boolean;
  connection_ok: boolean;
  account: BrokerAccountSnapshot | null;
  positions: BrokerPositionSnapshot[];
  positions_count: number;
  warnings: string[];
  errors: string[];
};

/**
 * Broker connector contract.
 * Safety invariant:
 * - Only read-only sync methods are implemented in Phase 1.
 * - Execution is intentionally disabled and must not be wired to strategy logic.
 */
export interface BrokerConnector {
  provider: BrokerProvider;
  mode: "read_only_scaffold" | "read_only_live";
  isConfigured(): boolean;
  fetchAccountReadOnly(): Promise<BrokerAccountSnapshot | null>;
  fetchPositionsReadOnly(): Promise<BrokerPositionSnapshot[]>;
  placeOrder(_payload: unknown): Promise<never>;
}
