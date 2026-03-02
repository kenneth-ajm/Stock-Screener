import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(high: number[], low: number[], close: number[], period = 14) {
  if (close.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const tr = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const universe_slug = (body?.universe_slug ?? "core_400").toString();
  const limit = typeof body?.limit === "number" ? Math.max(1, Math.min(600, body.limit)) : 300;
  const offset = typeof body?.offset === "number" ? Math.max(0, body.offset) : 0;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // scan date from SPY
  const { data: spyLatest, error: spyErr } = await supabase
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  if (spyErr || !spyLatest?.length) {
    return NextResponse.json({ ok: false, error: spyErr?.message || "No SPY data" }, { status: 500 });
  }

  const scanDate = spyLatest[0].date;

  // ✅ deterministic slice: ORDER BY symbol + range
  const from = offset;
  const to = offset + limit - 1;

  const { data: members, error: memErr } = await supabase
    .from("universe_members")
    .select("symbol, universes!inner(slug)")
    .eq("universes.slug", universe_slug)
    .eq("active", true)
    .order("symbol", { ascending: true })
    .range(from, to);

  if (memErr) {
    return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  }

  const symbols = (members ?? []).map((m: any) => String(m.symbol).toUpperCase()).filter(Boolean);

  const insertedRows: any[] = [];
  const skipped: any[] = [];

  for (const symbol of symbols) {
    const { data: bars, error: barErr } = await supabase
      .from("price_bars")
      .select("high,low,close,volume,date")
      .eq("symbol", symbol)
      .lte("date", scanDate)
      .order("date", { ascending: true });

    if (barErr || !bars || bars.length < 220) {
      skipped.push({ symbol, reason: barErr?.message || "Not enough history" });
      continue;
    }

    const closes = bars.map((b: any) => Number(b.close));
    const highs = bars.map((b: any) => Number(b.high));
    const lows = bars.map((b: any) => Number(b.low));
    const vols = bars.map((b: any) => Number(b.volume));

    const latestClose = closes[closes.length - 1];
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    const prevSma50 = sma(closes.slice(0, -1), 50);
    const rsi14 = rsi(closes, 14);
    const atr14 = atr(highs, lows, closes, 14);

    if (!sma50 || !sma200 || rsi14 === null || !atr14) {
      skipped.push({ symbol, reason: "Indicator null" });
      continue;
    }

    let score = 0;
    if (latestClose > sma50) score += 20;
    if (latestClose > sma200) score += 25;
    if (prevSma50 && sma50 > prevSma50) score += 10;
    if (rsi14 >= 45 && rsi14 <= 70) score += 20;

    score = clamp(score, 0, 100);

    let signal: "BUY" | "WATCH" | "AVOID" = "AVOID";
    if (score >= 60) signal = "BUY";
    else if (score >= 40) signal = "WATCH";

    insertedRows.push({
      date: scanDate,
      universe_slug,
      symbol,
      strategy_version: "v1",
      signal,
      confidence: Math.round(score),
      entry: latestClose,
      stop: latestClose - 2 * atr14,
    });
  }

  if (insertedRows.length) {
    const { error: upErr } = await supabase.from("daily_scans").upsert(insertedRows, {
      onConflict: "date,universe_slug,symbol,strategy_version",
    });
    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    universe_slug,
    scanDate,
    batch_offset: offset,
    batch_limit: limit,
    scanned: symbols.length,
    inserted: insertedRows.length,
    skipped: skipped.length,
  });
}