export type MarketDataProviderId = "polygon";

export type DailyPriceBar = {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketQuote = {
  symbol: string;
  price: number;
  as_of: string;
  session: "regular" | "extended" | "unknown";
};

export type ProviderCapabilities = {
  completed_daily_bars: boolean;
  grouped_daily_bars: boolean;
  indicative_quotes: boolean;
  consolidated_realtime_quotes: boolean;
  extended_hours: boolean;
};

export type ProviderProbeResult = {
  ok: boolean;
  provider: MarketDataProviderId;
  checked_at: string;
  duration_ms: number;
  daily_bars: {
    ok: boolean;
    latest_date: string | null;
    rows: number;
    response_status: string | null;
    error: string | null;
  };
  quote: {
    ok: boolean;
    as_of: string | null;
    error: string | null;
  };
};

export type GroupedDailyBarsResult = {
  provider: MarketDataProviderId;
  date: string;
  adjusted: boolean;
  http_status: number;
  response_status: string | null;
  bars: DailyPriceBar[];
};

export type SymbolDailyBarsResult = {
  provider: MarketDataProviderId;
  symbol: string;
  from: string;
  to: string;
  adjusted: boolean;
  http_status: number;
  response_status: string | null;
  bars: DailyPriceBar[];
};

export interface MarketDataProvider {
  readonly id: MarketDataProviderId;
  readonly label: string;
  readonly configured: boolean;
  readonly capabilities: ProviderCapabilities;
  fetchGroupedDailyBars(date: string): Promise<GroupedDailyBarsResult>;
  fetchDailyBars(symbol: string, from: string, to: string): Promise<SymbolDailyBarsResult>;
  fetchLatestQuote(symbol: string): Promise<MarketQuote | null>;
  probe(): Promise<ProviderProbeResult>;
}
