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
    json?.ticker?.lastTrade?.price,
    json?.ticker?.last_trade?.price,
    json?.ticker?.day?.c,
  ];
  for (const v of candidates) {
    const n = toNumber(v);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function scanCloseFromRow(row: any) {
  const fromIndicators = toNumber(row?.reason_json?.indicators?.close);
  const fromEntry = toNumber(row?.entry);
  return fromIndicators ?? fromEntry;
}

export async function GET(req: Request) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
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
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().trim();
  const date = (url.searchParams.get("date") ?? "").trim();
  const universe = (url.searchParams.get("universe") ?? "core_800").trim();
  const version = (url.searchParams.get("version") ?? "v2_core_momentum").trim();

  if (!symbol || !date) {
    return NextResponse.json(
      { ok: false, error: "symbol and date are required" },
      { status: 400 }
    );
  }

  const { data: row, error } = await supabase
    .from("daily_scans")
    .select("symbol, signal, confidence, entry, reason_summary, reason_json")
    .eq("symbol", symbol)
    .eq("date", date)
    .eq("universe_slug", universe)
    .eq("strategy_version", version)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "No explanation found for that symbol/date" },
      { status: 404 }
    );
  }

  const scan_close = scanCloseFromRow(row);
  const live_price = await fetchLivePrice(symbol);
  const divergence_pct =
    scan_close !== null && live_price !== null && scan_close > 0
      ? Math.abs(live_price - scan_close) / scan_close
      : null;

  return NextResponse.json({ ok: true, row, scan_close, live_price, divergence_pct });
}

export async function POST(req: Request) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
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

  const body = await req.json().catch(() => ({}));
  const symbol = String(body?.symbol ?? "").toUpperCase().trim();
  const date = String(body?.date ?? "").trim();
  const universe = String(body?.universe_slug ?? body?.universe ?? "core_800").trim();
  const version = String(body?.strategy_version ?? body?.version ?? "v2_core_momentum").trim();

  if (!symbol || !date) {
    return NextResponse.json(
      { ok: false, error: "symbol and date are required" },
      { status: 400 }
    );
  }

  const { data: row, error } = await supabase
    .from("daily_scans")
    .select("symbol, signal, confidence, entry, reason_summary, reason_json")
    .eq("symbol", symbol)
    .eq("date", date)
    .eq("universe_slug", universe)
    .eq("strategy_version", version)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "No explanation found for that symbol/date" },
      { status: 404 }
    );
  }

  const scan_close = scanCloseFromRow(row);
  const live_price = await fetchLivePrice(symbol);
  const divergence_pct =
    scan_close !== null && live_price !== null && scan_close > 0
      ? Math.abs(live_price - scan_close) / scan_close
      : null;

  return NextResponse.json({ ok: true, row, scan_close, live_price, divergence_pct });
}
