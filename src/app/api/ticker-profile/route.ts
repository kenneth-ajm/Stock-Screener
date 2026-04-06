import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

async function fetchTickerProfile(symbol: string, apiKey: string) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym || !apiKey) return null;
  const url = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(sym)}?apiKey=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const row = json?.results ?? null;
    if (!row) return null;
    return {
      symbol: sym,
      name: row?.name ? String(row.name) : null,
      market_cap: Number.isFinite(Number(row?.market_cap)) ? Number(row.market_cap) : null,
      primary_exchange: row?.primary_exchange ? String(row.primary_exchange) : null,
      type: row?.type ? String(row.type) : null,
      sic_description: row?.sic_description ? String(row.sic_description) : null,
      description: row?.description ? String(row.description) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    const symbol = String(new URL(req.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (!symbol) return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });

    const apiKey = process.env.POLYGON_API_KEY ?? "";
    const profile = await fetchTickerProfile(symbol, apiKey);
    return NextResponse.json({ ok: true, profile });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
