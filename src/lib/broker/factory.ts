import "server-only";

import { readBrokerEnv } from "@/lib/broker/env";
import { TigerReadOnlyConnector } from "@/lib/broker/connectors/tiger";
import type { BrokerConnector } from "@/lib/broker/types";

export function makeBrokerConnector(): BrokerConnector {
  const env = readBrokerEnv();
  if (env.provider === "tiger") {
    return new TigerReadOnlyConnector();
  }
  return new TigerReadOnlyConnector();
}
