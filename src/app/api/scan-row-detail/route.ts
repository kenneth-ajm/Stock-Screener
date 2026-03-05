import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function toNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchLivePrice(symbol: string) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey || !symbol) return null;

  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(
    symbol
  )}?apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);

  const candidates = [
    json?.ticker?.lastTrade?.p,
    json?.ticker?.last_trade?.p,
    json?.ticker?.day?.c,
  ];
  for (const v of candidates) {
    const n = toNumber(v);
    if (n !== null && n > 0) return n;
  }
  return null;
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
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const symbol = String(url.searchParams.get("symbol") ?? "").toUpperCase().trim();
    const date = String(url.searchParams.get("date") ?? "").trim();
    const universe = String(url.searchParams.get("universe_slug") ?? "core_800").trim();
    const version = String(url.searchParams.get("strategy_version") ?? "v2_core_momentum").trim();

    if (!symbol || !date) {
      return NextResponse.json({ ok: false, error: "symbol and date are required" }, { status: 400 });
    }

    const { data: row, error } = await supabase
      .from("daily_scans")
      .select("symbol,signal,confidence,entry,stop,tp1,tp2,reason_summary,reason_json")
      .eq("symbol", symbol)
      .eq("date", date)
      .eq("universe_slug", universe)
      .eq("strategy_version", version)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ ok: false, error: "Row not found" }, { status: 404 });

    const scanClose = toNumber(row?.entry);
    const livePrice = await fetchLivePrice(symbol);
    const divergencePct =
      scanClose !== null && livePrice !== null && scanClose > 0
        ? Math.abs(livePrice - scanClose) / scanClose
        : null;

    return NextResponse.json({
      ok: true,
      row,
      scan_close: scanClose,
      live_price: livePrice,
      divergence_pct: divergencePct,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

