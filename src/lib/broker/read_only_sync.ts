import "server-only";

import { makeBrokerConnector } from "@/lib/broker/factory";
import type { BrokerReadOnlyResult } from "@/lib/broker/types";

export async function getBrokerReadOnlySnapshot(): Promise<BrokerReadOnlyResult> {
  const connector = makeBrokerConnector();
  const configured = connector.isConfigured();
  const warnings: string[] = [];
  const errors: string[] = [];
  let auth_ok = false;
  let connection_ok = false;
  let account = null;
  let positions = [] as Awaited<ReturnType<typeof connector.fetchPositionsReadOnly>>;

  if (!configured) {
    warnings.push(
      "Broker credentials not configured. Set BROKER_PROVIDER=tiger and TIGER_* env vars."
    );
  } else {
    auth_ok = true;
  }

  if (configured) {
    try {
      account = await connector.fetchAccountReadOnly();
      connection_ok = true;
      if (account === null) {
        warnings.push("Configured broker returned no account snapshot.");
      }
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : typeof e === "string" ? e : "Account sync failed";
      errors.push(`account_sync: ${message}`);
      auth_ok = !/401|403|unauthorized|forbidden|auth/i.test(message);
      connection_ok = false;
    }
  }

  if (configured) {
    try {
      positions = await connector.fetchPositionsReadOnly();
      connection_ok = true;
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : typeof e === "string" ? e : "Positions sync failed";
      errors.push(`positions_sync: ${message}`);
      auth_ok = auth_ok && !/401|403|unauthorized|forbidden|auth/i.test(message);
      connection_ok = false;
    }
  }

  return {
    ok: errors.length === 0,
    provider: connector.provider,
    mode: connector.mode,
    configured,
    auth_ok,
    connection_ok,
    account,
    positions,
    positions_count: positions.length,
    warnings,
    errors,
  };
}
