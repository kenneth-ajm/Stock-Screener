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

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 2
): Promise<Response> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store" });
      if (res.status >= 500 && i < attempts - 1) {
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (i === attempts - 1) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tiger request failed");
}

function pickFirst(obj: any, keys: string[]): unknown {
  for (const key of keys) {
    if (obj && obj[key] != null) return obj[key];
  }
  return null;
}

export class TigerReadOnlyConnector implements BrokerConnector {
  provider = "tiger" as const;
  mode = "read_only_live" as const;

  private endpointUrl(pathOrUrl: string) {
    const env = readBrokerEnv();
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const base = env.tiger.base_url.replace(/\/+$/, "");
    const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${base}${path}`;
  }

  private headers() {
    const env = readBrokerEnv();
    return {
      "content-type": "application/json",
      authorization: `Bearer ${env.tiger.access_token}`,
      "x-tiger-client-id": env.tiger.client_id,
      "x-tiger-account-id": env.tiger.account_id,
    } as Record<string, string>;
  }

  isConfigured(): boolean {
    return tigerConfigured(readBrokerEnv());
  }

  async fetchAccountReadOnly(): Promise<BrokerAccountSnapshot | null> {
    const env = readBrokerEnv();
    const configured = tigerConfigured(env);
    if (!configured) return null;

    // Phase 1 safety boundary:
    // Read-only broker sync only. No execution and no strategy influence.
    const url = this.endpointUrl(env.tiger.account_endpoint);
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        cmd: "get_account",
        account_id: env.tiger.account_id,
      }),
    });
    if (!res.ok) {
      throw new Error(`Tiger account request failed (${res.status})`);
    }

    const json = await res.json().catch(() => null);
    const root = (json?.data ?? json?.result ?? json?.results ?? json) as any;
    const asOf = String(
      pickFirst(root, ["as_of", "asOf", "updated_at", "timestamp"]) ?? nowIso()
    );
    const currency = String(pickFirst(root, ["currency", "base_currency"]) ?? "USD");
    const cash = toNum(pickFirst(root, ["cash_available", "cash", "available_funds"]));
    const equity = toNum(pickFirst(root, ["equity", "net_liquidation", "net_asset_value"]));
    const buyingPower = toNum(
      pickFirst(root, ["buying_power", "buyingPower", "max_buying_power"])
    );

    return {
      account_id: env.tiger.account_id || "tiger_account",
      currency,
      cash_available: cash,
      equity,
      buying_power: buyingPower,
      as_of: asOf,
      source: "broker_api",
    };
  }

  async fetchPositionsReadOnly(): Promise<BrokerPositionSnapshot[]> {
    const env = readBrokerEnv();
    const configured = tigerConfigured(env);
    if (!configured) return [];

    const url = this.endpointUrl(env.tiger.positions_endpoint);
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        cmd: "get_positions",
        account_id: env.tiger.account_id,
      }),
    });
    if (!res.ok) {
      throw new Error(`Tiger positions request failed (${res.status})`);
    }

    const json = await res.json().catch(() => null);
    const list = (json?.data ?? json?.result ?? json?.results ?? json?.positions ?? []) as any[];
    if (!Array.isArray(list)) return [];
    const asOf = nowIso();
    return list
      .map((row: any) => {
        const symbol = String(
          pickFirst(row, ["symbol", "ticker", "contract", "instrument_id"]) ?? ""
        )
          .trim()
          .toUpperCase();
        const quantity = toNum(pickFirst(row, ["quantity", "qty", "position", "shares"])) ?? 0;
        const average_cost = toNum(pickFirst(row, ["average_cost", "avg_cost", "cost_price"]));
        const market_price = toNum(pickFirst(row, ["market_price", "last_price", "price"]));
        const market_value = toNum(pickFirst(row, ["market_value", "value"]));
        const unrealized_pnl = toNum(
          pickFirst(row, ["unrealized_pnl", "unrealized", "floating_pnl"])
        );
        return {
          symbol,
          quantity,
          average_cost,
          market_price,
          market_value,
          unrealized_pnl,
          as_of: asOf,
          source: "broker_api" as const,
        };
      })
      .filter((row) => row.symbol && row.quantity !== 0);
  }

  async placeOrder(_payload: unknown): Promise<never> {
    throw new Error(
      "Execution disabled: Tiger connector is read-only in Phase 1."
    );
  }
}
