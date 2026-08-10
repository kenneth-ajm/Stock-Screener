import type {
  DailyPriceBar,
  GroupedDailyBarsResult,
  MarketDataProvider,
  MarketQuote,
  ProviderProbeResult,
  SymbolDailyBarsResult,
} from "@/lib/market-data/types";

const BASE_URL = "https://api.polygon.io";
const DEFAULT_TIMEOUT_MS = 15_000;

type PolygonJson = {
  status?: string;
  error?: string;
  message?: string;
  results?: Array<Record<string, unknown>>;
  ticker?: {
    lastTrade?: { p?: unknown; t?: unknown };
    last_trade?: { p?: unknown; t?: unknown };
    min?: { c?: unknown; t?: unknown };
    day?: { c?: unknown };
    updated?: unknown;
  };
};

function validNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampToIso(value: unknown) {
  const raw = validNumber(value);
  if (raw === null || raw <= 0) return null;
  const milliseconds = raw > 1e16 ? raw / 1e6 : raw > 1e13 ? raw / 1e3 : raw;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseBar(symbol: string, row: Record<string, unknown>): DailyPriceBar | null {
  const timestamp = validNumber(row.t);
  const open = validNumber(row.o);
  const high = validNumber(row.h);
  const low = validNumber(row.l);
  const close = validNumber(row.c);
  const volume = validNumber(row.v);
  if (
    timestamp === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null
  ) {
    return null;
  }
  return {
    symbol,
    date: new Date(timestamp).toISOString().slice(0, 10),
    open,
    high,
    low,
    close,
    volume: Math.round(volume),
  };
}

async function polygonRequest(path: string, params: Record<string, string>, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("Polygon is not configured: missing POLYGON_API_KEY");

  const query = new URLSearchParams({ ...params, apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => null)) as PolygonJson | null;
    if (!response.ok) {
      const detail = String(json?.error ?? json?.message ?? `HTTP ${response.status}`);
      throw new Error(`Polygon request failed (${response.status}): ${detail.slice(0, 180)}`);
    }
    return { response, json };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Polygon request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export class PolygonMarketDataProvider implements MarketDataProvider {
  readonly id = "polygon" as const;
  readonly label = "Polygon";
  readonly configured = Boolean(process.env.POLYGON_API_KEY);
  readonly capabilities = {
    completed_daily_bars: true,
    grouped_daily_bars: true,
    indicative_quotes: true,
    consolidated_realtime_quotes: false,
    extended_hours: true,
  };

  async fetchGroupedDailyBars(date: string): Promise<GroupedDailyBarsResult> {
    const { response, json } = await polygonRequest(
      `/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(date)}`,
      { adjusted: "false" },
      30_000
    );
    const rows = Array.isArray(json?.results) ? json.results : [];
    const bars = rows
      .map((row) => {
        const symbol = String(row.T ?? "").trim().toUpperCase();
        return symbol ? parseBar(symbol, row) : null;
      })
      .filter((bar): bar is DailyPriceBar => Boolean(bar));
    return {
      provider: this.id,
      date,
      adjusted: false,
      http_status: response.status,
      response_status: json?.status ?? null,
      bars,
    };
  }

  async fetchDailyBars(symbol: string, from: string, to: string): Promise<SymbolDailyBarsResult> {
    const normalized = symbol.trim().toUpperCase();
    const { response, json } = await polygonRequest(
      `/v2/aggs/ticker/${encodeURIComponent(normalized)}/range/1/day/${from}/${to}`,
      { adjusted: "false", sort: "asc", limit: "50000" }
    );
    const rows = Array.isArray(json?.results) ? json.results : [];
    return {
      provider: this.id,
      symbol: normalized,
      from,
      to,
      adjusted: false,
      http_status: response.status,
      response_status: json?.status ?? null,
      bars: rows.map((row) => parseBar(normalized, row)).filter((bar): bar is DailyPriceBar => Boolean(bar)),
    };
  }

  async fetchLatestQuote(symbol: string): Promise<MarketQuote | null> {
    const normalized = symbol.trim().toUpperCase();
    const { json } = await polygonRequest(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(normalized)}`,
      {}
    );
    const ticker = json?.ticker ?? {};
    const candidates = [
      { price: ticker?.lastTrade?.p, timestamp: ticker?.lastTrade?.t },
      { price: ticker?.last_trade?.p, timestamp: ticker?.last_trade?.t },
      { price: ticker?.min?.c, timestamp: ticker?.min?.t },
      { price: ticker?.day?.c, timestamp: ticker?.updated },
    ];
    for (const candidate of candidates) {
      const price = validNumber(candidate.price);
      if (price === null || price <= 0) continue;
      return {
        symbol: normalized,
        price,
        as_of: timestampToIso(candidate.timestamp) ?? new Date().toISOString(),
        session: "unknown",
      };
    }
    return null;
  }

  async probe(): Promise<ProviderProbeResult> {
    const startedAt = Date.now();
    const from = dateDaysAgo(14);
    const to = new Date().toISOString().slice(0, 10);
    const [dailyResult, quoteResult] = await Promise.allSettled([
      this.fetchDailyBars("AAPL", from, to),
      this.fetchLatestQuote("AAPL"),
    ]);
    const daily = dailyResult.status === "fulfilled" ? dailyResult.value : null;
    const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
    return {
      ok: Boolean(daily?.bars.length && quote),
      provider: this.id,
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      daily_bars: {
        ok: Boolean(daily?.bars.length),
        latest_date: daily?.bars.at(-1)?.date ?? null,
        rows: daily?.bars.length ?? 0,
        response_status: daily?.response_status ?? null,
        error: dailyResult.status === "rejected" ? String(dailyResult.reason?.message ?? dailyResult.reason) : null,
      },
      quote: {
        ok: Boolean(quote),
        as_of: quote?.as_of ?? null,
        error: quoteResult.status === "rejected" ? String(quoteResult.reason?.message ?? quoteResult.reason) : null,
      },
    };
  }
}
