import "server-only";

import type { BrokerProvider } from "@/lib/broker/types";

export type BrokerEnv = {
  provider: BrokerProvider;
  tiger: {
    private_key: string;
    account_id: string;
    client_id: string;
    access_token: string;
    base_url: string;
    account_endpoint: string;
    positions_endpoint: string;
  };
};

function parseProvider(raw: string | undefined): BrokerProvider {
  const value = String(raw ?? "tiger").trim().toLowerCase();
  if (value === "tiger") return "tiger";
  return "tiger";
}

export function readBrokerEnv(): BrokerEnv {
  const base_url = String(process.env.TIGER_BASE_URL ?? "https://openapi.tigerfintech.com").trim();
  return {
    provider: parseProvider(process.env.BROKER_PROVIDER),
    tiger: {
      private_key: String(process.env.TIGER_PRIVATE_KEY ?? "").trim(),
      account_id: String(process.env.TIGER_ACCOUNT_ID ?? "").trim(),
      client_id: String(process.env.TIGER_CLIENT_ID ?? "").trim(),
      access_token: String(process.env.TIGER_ACCESS_TOKEN ?? "").trim(),
      base_url,
      account_endpoint: String(process.env.TIGER_ACCOUNT_ENDPOINT ?? "/gateway").trim(),
      positions_endpoint: String(process.env.TIGER_POSITIONS_ENDPOINT ?? "/gateway").trim(),
    },
  };
}

export function tigerConfigured(env: BrokerEnv) {
  return Boolean(env.tiger.account_id && env.tiger.client_id && env.tiger.private_key && env.tiger.base_url);
}
