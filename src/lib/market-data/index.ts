import { PolygonMarketDataProvider } from "@/lib/market-data/polygon";
import type { MarketDataProvider, MarketDataProviderId } from "@/lib/market-data/types";

export type { DailyPriceBar, MarketDataProvider, MarketQuote, ProviderProbeResult } from "@/lib/market-data/types";

export function configuredMarketDataProviderId(): MarketDataProviderId {
  const configured = String(process.env.MARKET_DATA_PROVIDER ?? "polygon").trim().toLowerCase();
  if (configured === "polygon") return "polygon";
  throw new Error(`Unsupported MARKET_DATA_PROVIDER: ${configured}`);
}

export function getMarketDataProvider(): MarketDataProvider {
  const provider = configuredMarketDataProviderId();
  if (provider === "polygon") return new PolygonMarketDataProvider();
  throw new Error(`Unsupported market data provider: ${provider}`);
}

export function getMarketDataProviderInfo() {
  const provider = getMarketDataProvider();
  return {
    id: provider.id,
    label: provider.label,
    configured: provider.configured,
    capabilities: provider.capabilities,
  };
}
