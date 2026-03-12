import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { evaluateCoreMomentumSwing, isoDate, type RegimeState } from "@/lib/strategy/coreMomentumSwing";

type PriceBarRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function asNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const authClient = createServerClient(
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
  } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const symbolRaw = String((body as { symbol?: string })?.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!symbolRaw) return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: spyLatest, error: spyErr } = await supabase
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);
  if (spyErr || !spyLatest || spyLatest.length === 0) {
    return NextResponse.json({ ok: false, error: spyErr?.message || "No SPY bars found" }, { status: 500 });
  }

  const scanDate = String(spyLatest[0].date);
  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("date,state")
    .eq("symbol", "SPY")
    .lte("date", scanDate)
    .order("date", { ascending: false })
    .limit(1);
  const regime = ((regimeRows?.[0]?.state as RegimeState | undefined) ?? "CAUTION") as RegimeState;

  let { data: bars } = await supabase
    .from("price_bars")
    .select("date,open,high,low,close,volume")
    .eq("symbol", symbolRaw)
    .eq("source", "polygon")
    .lte("date", scanDate)
    .order("date", { ascending: true });

  if (!bars || bars.length < 220) {
    // Fallback-only targeted hydration for one symbol.
    // Keeps manual score/check usable without triggering heavy global refresh jobs.
    const polygonKey = process.env.POLYGON_API_KEY;
    if (!polygonKey) {
      return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
    }

    const to = new Date(scanDate);
    const from = new Date(to);
    from.setDate(from.getDate() - 750);

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbolRaw)}` +
      `/range/1/day/${toISODate(from)}/${toISODate(to)}` +
      `?adjusted=false&sort=asc&limit=50000&apiKey=${encodeURIComponent(polygonKey)}`;

    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      const message = await resp.text().catch(() => "");
      return NextResponse.json({ ok: false, error: `Polygon error: ${message || resp.status}` }, { status: 500 });
    }

    const parsed = (await resp.json().catch(() => null)) as { results?: Array<Record<string, unknown>> } | null;
    const results = Array.isArray(parsed?.results) ? parsed.results : [];

    if (results.length > 0) {
      const upsertRows: Array<{
        symbol: string;
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
      }> = [];

      for (const row of results) {
        const t = asNumber(row.t);
        const o = asNumber(row.o);
        const h = asNumber(row.h);
        const l = asNumber(row.l);
        const c = asNumber(row.c);
        const v = asNumber(row.v);
        if (t == null || o == null || h == null || l == null || c == null || v == null) continue;
        upsertRows.push({
          symbol: symbolRaw,
          date: isoDate(new Date(t)),
          open: o,
          high: h,
          low: l,
          close: c,
          volume: Math.round(v),
          source: "polygon",
        });
      }

      if (upsertRows.length > 0) {
        const { error: upErr } = await supabase
          .from("price_bars")
          .upsert(upsertRows, { onConflict: "symbol,date" });
        if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
      }
    }

    const { data: reloaded } = await supabase
      .from("price_bars")
      .select("date,open,high,low,close,volume")
      .eq("symbol", symbolRaw)
      .eq("source", "polygon")
      .lte("date", scanDate)
      .order("date", { ascending: true });
    bars = reloaded;
  }

  if (!bars || bars.length < 220) {
    return NextResponse.json(
      { ok: false, error: `Not enough history for ${symbolRaw} (need >=220 bars)` },
      { status: 400 }
    );
  }

  const cleanBars: PriceBarRow[] = bars
    .map((bar: Record<string, unknown>) => {
      const open = asNumber(bar.open);
      const high = asNumber(bar.high);
      const low = asNumber(bar.low);
      const close = asNumber(bar.close);
      const volume = asNumber(bar.volume);
      if (open == null || high == null || low == null || close == null || volume == null) return null;
      return {
        date: String(bar.date),
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter((bar): bar is PriceBarRow => bar !== null);

  if (cleanBars.length < 220) {
    return NextResponse.json({ ok: false, error: "Insufficient clean bars after parsing" }, { status: 400 });
  }

  const evaluation = evaluateCoreMomentumSwing({ bars: cleanBars, regime });
  if (!evaluation) {
    return NextResponse.json({ ok: false, error: "Indicator calculation failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    symbol: symbolRaw,
    scanDate,
    signal: evaluation.signal,
    confidence: evaluation.confidence,
    entry: evaluation.entry,
    stop: evaluation.stop,
    tp1: evaluation.tp1,
    tp2: evaluation.tp2,
    max_holding_days: evaluation.max_holding_days,
    reason_summary: evaluation.reason_summary,
    reason_json: evaluation.reason_json,
  });
}
