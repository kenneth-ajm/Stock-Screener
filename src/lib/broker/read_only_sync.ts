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
  let debug: Record<string, unknown> | null = null;

  if (!configured) {
    warnings.push(
      "Broker credentials not configured. Set BROKER_PROVIDER=tiger with TIGER_CLIENT_ID, TIGER_ACCOUNT_ID, TIGER_PRIVATE_KEY."
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
      auth_ok = !/401|403|unauthorized|forbidden|auth|private key|sign|decoder|pem|pkcs/i.test(
        message
      );
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
      auth_ok =
        auth_ok &&
        !/401|403|unauthorized|forbidden|auth|private key|sign|decoder|pem|pkcs/i.test(message);
      connection_ok = false;
    }
  }
  debug = connector.getReadOnlyDebug ? connector.getReadOnlyDebug() : null;

  if (configured && !errors.length) {
    const accountZeroish =
      account != null &&
      (account.cash_available == null || account.cash_available === 0) &&
      (account.equity == null || account.equity === 0) &&
      (account.buying_power == null || account.buying_power === 0);
    if (accountZeroish && positions.length === 0) {
      warnings.push(
        "Broker returned zero/empty account snapshot. Verify Tiger endpoint/account environment and inspect broker.debug parse summary."
      );
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
    debug,
  };
}
