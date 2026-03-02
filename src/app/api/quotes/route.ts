import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Body = {
  symbols?: string[];
};

function uniqUpper(symbols: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of symbols) {
    const sym = (s ?? "").trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

async function fetchSnapshot(symbol: string, apiKey: string): Promise<number | null> {
  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(
    symbol
  )}?apiKey=${apiKey}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);

  const candidates = [
    json?.ticker?.lastTrade?.p,
    json?.ticker?.last_trade?.p,
    json?.ticker?.lastTrade?.price,
    json?.ticker?.last_trade?.price,
    json?.ticker?.day?.c, // fallback to today's close if trade not present
  ];

  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

async function fetchLastTrade(symbol: string, apiKey: string): Promise<number | null> {
  const url = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(symbol)}?apiKey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);

  const v = json?.results?.p;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return null;
}

export async function POST(req: Request) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const symbols = uniqUpper(Array.isArray(body.symbols) ? body.symbols : []);

  if (symbols.length === 0) {
    return NextResponse.json({ ok: true, quotes: {} });
  }

  // soft limit to keep requests reasonable
  const limited = symbols.slice(0, 50);

  const entries = await Promise.all(
    limited.map(async (sym) => {
      let price = await fetchSnapshot(sym, apiKey);
      if (price === null) price = await fetchLastTrade(sym, apiKey);
      return [sym, price] as const;
    })
  );

  const quotes: Record<string, number | null> = {};
  for (const [sym, price] of entries) quotes[sym] = price ?? null;

  return NextResponse.json({ ok: true, quotes });
}