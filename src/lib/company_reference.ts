import "server-only";

import { unstable_cache } from "next/cache";

export type CompanyReference = {
  symbol: string;
  name: string | null;
  type: string | null;
  primary_exchange: string | null;
};

type PolygonReferenceRow = {
  ticker?: string;
  name?: string;
  type?: string;
  primary_exchange?: string;
};

type PolygonReferencePage = {
  results?: PolygonReferenceRow[];
  next_url?: string | null;
};

const loadCompanyReferenceMap = unstable_cache(
  async (): Promise<Record<string, CompanyReference>> => {
    const apiKey = process.env.POLYGON_API_KEY ?? "";
    if (!apiKey) return {};

    let nextUrl: string | null =
      `https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000&sort=ticker&apiKey=${encodeURIComponent(apiKey)}`;
    const references: Record<string, CompanyReference> = {};
    let page = 0;

    while (nextUrl && page < 30) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response: Response = await fetch(nextUrl, { cache: "no-store", signal: controller.signal });
        if (!response.ok) break;
        const payload: PolygonReferencePage | null = await response.json().catch(() => null);
        const rows = Array.isArray(payload?.results) ? payload.results : [];
        for (const row of rows) {
          const symbol = String(row?.ticker ?? "").trim().toUpperCase();
          if (!symbol) continue;
          references[symbol] = {
            symbol,
            name: row?.name ? String(row.name) : null,
            type: row?.type ? String(row.type) : null,
            primary_exchange: row?.primary_exchange ? String(row.primary_exchange) : null,
          };
        }
        const rawNext: string = payload?.next_url ? String(payload.next_url) : "";
        nextUrl = rawNext
          ? `${rawNext}${rawNext.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`
          : null;
        page += 1;
      } catch {
        break;
      } finally {
        clearTimeout(timeout);
      }
    }

    return references;
  },
  ["polygon-company-reference-map-v1"],
  { revalidate: 60 * 60 * 24 * 30 }
);

export async function getCompanyReferences(symbols: string[]) {
  const normalized = [...new Set(symbols.map((symbol) => String(symbol ?? "").trim().toUpperCase()).filter(Boolean))].slice(0, 60);
  const references = await loadCompanyReferenceMap();
  return normalized.map(
    (symbol) => references[symbol] ?? { symbol, name: null, type: null, primary_exchange: null }
  );
}
