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
      .select("symbol,signal,confidence,entry,stop,tp1,tp2,rank,rank_score,quality_score,reason_summary,reason_json")
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
    const { data: historyRows } = await supabase
      .from("daily_scans")
      .select("date,signal,confidence,rank,rank_score,quality_score,reason_summary")
      .eq("symbol", symbol)
      .eq("strategy_version", version)
      .eq("universe_slug", universe)
      .order("date", { ascending: false })
      .limit(8);
    const recentHistory = (historyRows ?? []).map((item: any) => ({
      date: item?.date ? String(item.date) : null,
      signal:
        item?.signal === "BUY" || item?.signal === "WATCH" || item?.signal === "AVOID"
          ? item.signal
          : null,
      confidence: toNumber(item?.confidence),
      rank: toNumber(item?.rank),
      rank_score: toNumber(item?.rank_score),
      quality_score: toNumber(item?.quality_score),
      reason_summary: item?.reason_summary ? String(item.reason_summary) : null,
    }));

    const { data: barRows } = await supabase
      .from("price_bars")
      .select("date,open,high,low,close,volume")
      .eq("symbol", symbol)
      .eq("source", "polygon")
      .lte("date", date)
      .order("date", { ascending: false })
      .limit(30);
    const barsDesc = Array.isArray(barRows) ? barRows : [];
    const barsAsc = [...barsDesc].reverse();
    const latestBar = barsAsc.length > 0 ? barsAsc[barsAsc.length - 1] : null;
    const close5 = barsAsc.length >= 6 ? toNumber(barsAsc[barsAsc.length - 6]?.close) : null;
    const close20 = barsAsc.length >= 21 ? toNumber(barsAsc[barsAsc.length - 21]?.close) : null;
    const latestClose = toNumber(latestBar?.close);
    const ret5 =
      latestClose != null && close5 != null && close5 > 0 ? ((latestClose - close5) / close5) * 100 : null;
    const ret20 =
      latestClose != null && close20 != null && close20 > 0 ? ((latestClose - close20) / close20) * 100 : null;
    const high20 =
      barsAsc.length >= 20
        ? Math.max(...barsAsc.slice(Math.max(0, barsAsc.length - 20)).map((bar: any) => Number(bar?.high ?? 0)))
        : null;
    const low20 =
      barsAsc.length >= 20
        ? Math.min(...barsAsc.slice(Math.max(0, barsAsc.length - 20)).map((bar: any) => Number(bar?.low ?? 0)))
        : null;
    const checks = Array.isArray((row as any)?.reason_json?.checks)
      ? (row as any).reason_json.checks
          .map((check: any) => ({
            key: check?.key ? String(check.key) : check?.id ? String(check.id) : null,
            category: check?.category ? String(check.category) : null,
            ok: typeof check?.ok === "boolean" ? check.ok : null,
            detail: check?.detail ? String(check.detail) : null,
          }))
          .filter((check: any) => check.key)
      : [];

    return NextResponse.json({
      ok: true,
      row,
      scan_close: scanClose,
      live_price: livePrice,
      divergence_pct: divergencePct,
      recent_history: recentHistory,
      price_context: {
        latest_bar_date: latestBar?.date ? String(latestBar.date) : null,
        latest_close: latestClose,
        return_5d_pct: ret5,
        return_20d_pct: ret20,
        high_20bar: Number.isFinite(Number(high20)) && high20 != null ? high20 : null,
        low_20bar: Number.isFinite(Number(low20)) && low20 != null ? low20 : null,
      },
      explainability_checks: checks,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
