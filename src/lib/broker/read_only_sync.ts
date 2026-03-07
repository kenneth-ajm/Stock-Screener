import "server-only";

import { makeBrokerConnector } from "@/lib/broker/factory";
import type { BrokerReadOnlyResult } from "@/lib/broker/types";

export async function getBrokerReadOnlySnapshot(): Promise<BrokerReadOnlyResult> {
  const connector = makeBrokerConnector();
  const configured = connector.isConfigured();
  const warnings: string[] = [];

  if (!configured) {
    warnings.push(
      "Broker credentials not configured. Set BROKER_PROVIDER=tiger and TIGER_* env vars."
    );
  }

  const account = await connector.fetchAccountReadOnly();
  const positions = await connector.fetchPositionsReadOnly();

  if (configured && account === null) {
    warnings.push("Configured broker returned no account snapshot (stub or unavailable).");
  }

  return {
    ok: true,
    provider: connector.provider,
    mode: connector.mode,
    configured,
    account,
    positions,
    warnings,
  };
}
