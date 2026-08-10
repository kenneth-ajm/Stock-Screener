import type {
  MarketQuote,
  MarketQuoteProvider,
  ProviderCapabilities,
} from "@/lib/market-data/types";

const DEFAULT_BASE_URL = "https://data.alpaca.markets";
const DEFAULT_TIMEOUT_MS = 10_000;

type AlpacaTrade = {
  p?: unknown;
  t?: unknown;
};

type AlpacaBar = {
  c?: unknown;
  t?: unknown;
};

type AlpacaSnapshot = {
  latestTrade?: AlpacaTrade | null;
  minuteBar?: AlpacaBar | null;
  dailyBar?: AlpacaBar | null;
};

type AlpacaSnapshotsResponse = {
  snapshots?: Record<string, AlpacaSnapshot>;
  code?: unknown;
  message?: unknown;
} & Record<string, unknown>;

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isoTimestamp(value: unknown) {
  const timestamp = String(value ?? "").trim();
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSymbols(symbols: string[]) {
  return Array.from(
    new Set(symbols.map((symbol) => String(symbol ?? "").trim().toUpperCase()).filter(Boolean))
  ).slice(0, 50);
}

function parseSnapshot(symbol: string, snapshot: AlpacaSnapshot | null | undefined): MarketQuote | null {
  const candidates = [
    { price: snapshot?.latestTrade?.p, timestamp: snapshot?.latestTrade?.t },
    { price: snapshot?.minuteBar?.c, timestamp: snapshot?.minuteBar?.t },
    { price: snapshot?.dailyBar?.c, timestamp: snapshot?.dailyBar?.t },
  ];
  for (const candidate of candidates) {
    const price = positiveNumber(candidate.price);
    if (price === null) continue;
    return {
      symbol,
      price,
      as_of: isoTimestamp(candidate.timestamp) ?? new Date().toISOString(),
      session: "unknown",
    };
  }
  return null;
}

export class AlpacaQuoteProvider implements MarketQuoteProvider {
  readonly id = "alpaca" as const;
  readonly label = "Alpaca IEX";
  readonly configured = Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET);
  readonly capabilities: ProviderCapabilities = {
    completed_daily_bars: false,
    grouped_daily_bars: false,
    indicative_quotes: true,
    consolidated_realtime_quotes: false,
    extended_hours: true,
  };

  private get baseUrl() {
    return String(process.env.ALPACA_DATA_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  }

  private get feed() {
    return String(process.env.ALPACA_DATA_FEED ?? "iex").trim().toLowerCase() || "iex";
  }

  private async request(path: string, params: Record<string, string>) {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error("Alpaca quotes are not configured");

    const query = new URLSearchParams(params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}${path}?${query.toString()}`, {
        cache: "no-store",
        headers: {
          "APCA-API-KEY-ID": apiKey,
          "APCA-API-SECRET-KEY": apiSecret,
        },
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as AlpacaSnapshotsResponse | null;
      if (!response.ok) {
        const detail = String(json?.message ?? `HTTP ${response.status}`).slice(0, 180);
        throw new Error(`Alpaca quote request failed (${response.status}): ${detail}`);
      }
      return json ?? {};
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Alpaca quote request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchLatestQuotes(symbols: string[]) {
    const normalized = normalizeSymbols(symbols);
    const quotes = new Map<string, MarketQuote>();
    if (normalized.length === 0) return quotes;

    const json = await this.request("/v2/stocks/snapshots", {
      symbols: normalized.join(","),
      feed: this.feed,
    });
    const payload = (json.snapshots && typeof json.snapshots === "object" ? json.snapshots : json) as Record<
      string,
      AlpacaSnapshot
    >;
    for (const symbol of normalized) {
      const quote = parseSnapshot(symbol, payload[symbol]);
      if (quote) quotes.set(symbol, quote);
    }
    return quotes;
  }

  async fetchLatestQuote(symbol: string) {
    const normalized = normalizeSymbols([symbol])[0];
    if (!normalized) return null;
    return (await this.fetchLatestQuotes([normalized])).get(normalized) ?? null;
  }
}
