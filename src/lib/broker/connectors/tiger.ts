import "server-only";

import { readBrokerEnv, tigerConfigured } from "@/lib/broker/env";
import type {
  BrokerAccountSnapshot,
  BrokerConnector,
  BrokerPositionSnapshot,
} from "@/lib/broker/types";

function nowIso() {
  return new Date().toISOString();
}

export class TigerReadOnlyConnector implements BrokerConnector {
  provider = "tiger" as const;
  mode = "read_only_scaffold" as const;

  isConfigured(): boolean {
    return tigerConfigured(readBrokerEnv());
  }

  async fetchAccountReadOnly(): Promise<BrokerAccountSnapshot | null> {
    const env = readBrokerEnv();
    const configured = tigerConfigured(env);
    if (!configured) return null;

    // Phase 1 safety boundary:
    // Read-only scaffold only. No live broker API calls are made yet.
    // This shape allows Phase 2 account sync wiring without touching scanner logic.
    return {
      account_id: env.tiger.account_id || "tiger_account",
      currency: "USD",
      cash_available: null,
      equity: null,
      buying_power: null,
      as_of: nowIso(),
      source: "stub",
    };
  }

  async fetchPositionsReadOnly(): Promise<BrokerPositionSnapshot[]> {
    const configured = this.isConfigured();
    if (!configured) return [];

    // Phase 1 safety boundary:
    // Position sync is intentionally stubbed until API contract is validated.
    return [];
  }

  async placeOrder(_payload: unknown): Promise<never> {
    throw new Error(
      "Execution disabled: Tiger connector is read-only scaffold in Phase 1."
    );
  }
}
