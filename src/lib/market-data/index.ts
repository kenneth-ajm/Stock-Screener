import { AlpacaQuoteProvider } from "@/lib/market-data/alpaca";
import { PolygonMarketDataProvider } from "@/lib/market-data/polygon";
import type {
  MarketDataProvider,
  MarketDataProviderId,
  MarketQuoteProvider,
  MarketQuoteProviderId,
} from "@/lib/market-data/types";

export type {
  DailyPriceBar,
  MarketDataProvider,
  MarketQuote,
  MarketQuoteProvider,
  ProviderProbeResult,
} from "@/lib/market-data/types";

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

export function configuredMarketQuoteProviderId(): MarketQuoteProviderId {
  const configured = String(process.env.MARKET_QUOTE_PROVIDER ?? "polygon").trim().toLowerCase();
  if (configured === "polygon" || configured === "alpaca") return configured;
  throw new Error(`Unsupported MARKET_QUOTE_PROVIDER: ${configured}`);
}

export function getMarketQuoteProvider(): MarketQuoteProvider {
  const provider = configuredMarketQuoteProviderId();
  if (provider === "alpaca") return new AlpacaQuoteProvider();
  return new PolygonMarketDataProvider();
}

export function getMarketQuoteProviderInfo() {
  const provider = getMarketQuoteProvider();
  return {
    id: provider.id,
    label: provider.label,
    configured: provider.configured,
    capabilities: provider.capabilities,
  };
}
