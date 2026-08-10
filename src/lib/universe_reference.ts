import type { SupabaseClient } from "@supabase/supabase-js";

const POLYGON_REFERENCE_BASE = "https://api.polygon.io/v3/reference/tickers";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url: string, label: string, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`${label} failed (${response.status}): ${json?.error ?? json?.message ?? "unknown"}`);
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export async function fetchActiveUsCommonSymbols(apiKey: string, maxPages = 30) {
  const symbols = new Set<string>();
  let nextUrl: string | null =
    `${POLYGON_REFERENCE_BASE}?market=stocks&locale=us&active=true&type=CS` +
    `&limit=1000&sort=ticker&order=asc&apiKey=${encodeURIComponent(apiKey)}`;
  let pages = 0;
  while (nextUrl && pages < maxPages) {
    pages += 1;
    const json = await fetchJsonWithRetry(nextUrl, `Polygon common-stock page ${pages}`);
    for (const row of json?.results ?? []) {
      const symbol = String(row?.ticker ?? "").trim().toUpperCase();
      if (symbol) symbols.add(symbol);
    }
    const rawNext = json?.next_url ? String(json.next_url) : "";
    nextUrl = rawNext
      ? `${rawNext}${rawNext.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`
      : null;
  }
  return symbols;
}

export async function fetchPolygonMarketCaps(
  apiKey: string,
  symbols: string[],
  concurrency = 20
) {
  const marketCaps = new Map<string, number>();
  const uniqueSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)));
  let cursor = 0;
  const worker = async () => {
    while (cursor < uniqueSymbols.length) {
      const index = cursor;
      cursor += 1;
      const symbol = uniqueSymbols[index];
      try {
        const json = await fetchJsonWithRetry(
          `${POLYGON_REFERENCE_BASE}/${encodeURIComponent(symbol)}?apiKey=${encodeURIComponent(apiKey)}`,
          `Polygon ticker details ${symbol}`
        );
        const marketCap = Number(json?.results?.market_cap);
        if (Number.isFinite(marketCap) && marketCap > 0) marketCaps.set(symbol, marketCap);
      } catch (error) {
        console.warn("[universe-reference] market cap unavailable", {
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), uniqueSymbols.length || 1) }, () => worker())
  );
  return marketCaps;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function loadAverageDollarVolume20(opts: {
  supabase: SupabaseClient;
  symbols: string[];
  scanDate: string;
}) {
  const from = new Date(`${opts.scanDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 45);
  const fromDate = isoDate(from);
  const result = new Map<string, number>();

  for (let index = 0; index < opts.symbols.length; index += 300) {
    const symbolChunk = opts.symbols.slice(index, index + 300);
    const rows: Array<Record<string, unknown>> = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await opts.supabase
        .from("price_bars")
        .select("symbol,date,close,volume")
        .in("symbol", symbolChunk)
        .eq("source", "polygon")
        .gte("date", fromDate)
        .lte("date", opts.scanDate)
        .order("symbol", { ascending: true })
        .order("date", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Universe liquidity bars failed: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < pageSize) break;
    }

    const valuesBySymbol = new Map<string, number[]>();
    for (const row of rows) {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      const close = Number(row.close);
      const volume = Number(row.volume);
      if (!symbol || !Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume <= 0) continue;
      if (!valuesBySymbol.has(symbol)) valuesBySymbol.set(symbol, []);
      valuesBySymbol.get(symbol)!.push(close * volume);
    }
    for (const [symbol, values] of valuesBySymbol) {
      const last20 = values.slice(-20);
      if (last20.length < 20) continue;
      result.set(symbol, last20.reduce((sum, value) => sum + value, 0) / last20.length);
    }
  }

  return result;
}
