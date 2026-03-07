import "server-only";

import type { BrokerProvider } from "@/lib/broker/types";

export type BrokerEnv = {
  provider: BrokerProvider;
  tiger: {
    private_key: string;
    account_id: string;
    client_id: string;
  };
};

function parseProvider(raw: string | undefined): BrokerProvider {
  const value = String(raw ?? "tiger").trim().toLowerCase();
  if (value === "tiger") return "tiger";
  return "tiger";
}

export function readBrokerEnv(): BrokerEnv {
  return {
    provider: parseProvider(process.env.BROKER_PROVIDER),
    tiger: {
      private_key: String(process.env.TIGER_PRIVATE_KEY ?? "").trim(),
      account_id: String(process.env.TIGER_ACCOUNT_ID ?? "").trim(),
      client_id: String(process.env.TIGER_CLIENT_ID ?? "").trim(),
    },
  };
}

export function tigerConfigured(env: BrokerEnv) {
  return Boolean(env.tiger.private_key && env.tiger.account_id && env.tiger.client_id);
}
