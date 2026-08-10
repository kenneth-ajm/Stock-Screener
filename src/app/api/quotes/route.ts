import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMarketDataProvider } from "@/lib/market-data";
import { supabaseServer } from "@/lib/supabase/server";

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
  for (const symbol of symbols) {
    const normalized = String(symbol ?? "").trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function cachedClose(supabase: ReturnType<typeof admin>, symbol: string): Promise<QuoteValue | null> {
  const { data, error } = await supabase
    .from("price_bars")
    .select("date,close")
    .eq("symbol", symbol)
    .eq("source", "polygon")
    .order("date", { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const close = Number(data[0]?.close);
  const date = String(data[0]?.date ?? "");
  if (!Number.isFinite(close) || close <= 0 || !date) return null;
  return { price: close, asOf: date, source: "eod_close" };
}

export async function POST(req: Request) {
  const authClient = await supabaseServer();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const symbols = uniqUpper(Array.isArray(body.symbols) ? body.symbols : []).slice(0, 50);
  if (symbols.length === 0) {
    return NextResponse.json({ ok: true, quotes: {}, provider: null, quote_mode: "none" });
  }

  const provider = getMarketDataProvider();
  const database = admin();
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      if (provider.configured) {
        try {
          const quote = await provider.fetchLatestQuote(symbol);
          if (quote) {
            return [
              symbol,
              { price: quote.price, asOf: quote.as_of, source: "snapshot" as const },
            ] as const;
          }
        } catch (error) {
          console.warn("[quotes] provider quote unavailable; using cached close", {
            provider: provider.id,
            symbol,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return [symbol, await cachedClose(database, symbol)] as const;
    })
  );

  const quotes: Record<string, QuoteValue | null> = {};
  for (const [symbol, quote] of entries) quotes[symbol] = quote;
  const liveCount = entries.filter(([, quote]) => quote?.source === "snapshot").length;

  return NextResponse.json({
    ok: true,
    quotes,
    provider: provider.id,
    provider_configured: provider.configured,
    quote_mode: liveCount > 0 ? "provider_snapshot_with_cached_fallback" : "cached_eod_only",
    live_quotes: liveCount,
    cached_quotes: entries.filter(([, quote]) => quote?.source === "eod_close").length,
  });
}
