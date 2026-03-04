import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Body = {
  symbols?: string[];
};

type QuoteValue = {
  price: number;
  asOf: string;
  source: "snapshot" | "eod_close";
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

async function fetchSnapshot(symbol: string, apiKey: string): Promise<QuoteValue | null> {
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
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return {
        price: v,
        asOf: new Date().toISOString(),
        source: "snapshot",
      };
    }
  }
  return null;
}

async function fetchLastTrade(symbol: string, apiKey: string): Promise<QuoteValue | null> {
  const url = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(symbol)}?apiKey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);

  const v = json?.results?.p;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return {
      price: v,
      asOf: new Date().toISOString(),
      source: "snapshot",
    };
  }
  return null;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } });
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
      let quote = await fetchSnapshot(sym, apiKey);
      if (quote === null) quote = await fetchLastTrade(sym, apiKey);
      return [sym, quote] as const;
    })
  );

  const quotes: Record<string, QuoteValue | null> = {};
  for (const [sym, quote] of entries) quotes[sym] = quote ?? null;

  const missing = Object.entries(quotes)
    .filter(([, v]) => v == null)
    .map(([sym]) => sym);

  if (missing.length > 0) {
    const supabase = admin() as any;
    const { data: bars, error } = await supabase
      .from("price_bars")
      .select("symbol,date,close")
      .in("symbol", missing)
      .eq("source", "polygon")
      .order("symbol", { ascending: true })
      .order("date", { ascending: false });

    if (!error && Array.isArray(bars)) {
      const latestBySymbol = new Map<string, { date: string; close: number }>();
      for (const row of bars) {
        const sym = String(row?.symbol ?? "").toUpperCase();
        if (!sym || latestBySymbol.has(sym)) continue;
        const close = Number(row?.close);
        const date = String(row?.date ?? "");
        if (!Number.isFinite(close) || close <= 0 || !date) continue;
        latestBySymbol.set(sym, { date, close });
      }
      for (const sym of missing) {
        const latest = latestBySymbol.get(sym);
        if (!latest) continue;
        quotes[sym] = {
          price: latest.close,
          asOf: latest.date,
          source: "eod_close",
        };
      }
    }
  }

  return NextResponse.json({ ok: true, quotes });
}
