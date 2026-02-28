import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Bar = {
  date: string;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
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

export async function GET() {
  return NextResponse.json({
    ok: false,
    message: "Use POST. Go to /screener and click 'Run Daily Scan'.",
  });
}

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1) Use SPY latest bar as the global scan date
  const { data: spyLatest, error: spyErr } = await supabase
    .from("price_bars")
    .select("date, close")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  if (spyErr || !spyLatest || spyLatest.length === 0) {
    return NextResponse.json(
      { ok: false, error: spyErr?.message || "No SPY bars found" },
      { status: 500 }
    );
  }

  const scanDate = spyLatest[0].date as string;

  // 2) Latest regime
  const { data: regimeRows, error: regErr } = await supabase
    .from("market_regime")
    .select("date, state")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  if (regErr) {
    return NextResponse.json({ ok: false, error: regErr.message }, { status: 500 });
  }

  const regimeState: "FAVORABLE" | "CAUTION" | "DEFENSIVE" =
    (regimeRows?.[0]?.state as any) ?? "CAUTION";

  // 3) Universe members
  const { data: members, error: memErr } = await supabase
    .from("universe_members")
    .select("symbol, active, universe_id, universes!inner(slug)")
    .eq("universes.slug", "core_400")
    .eq("active", true);

  if (memErr) {
    return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  }

  const symbols = (members ?? []).map((m: any) => String(m.symbol).toUpperCase());
  if (symbols.length === 0) {
    return NextResponse.json({ ok: false, error: "No symbols in core_400" });
  }

  const strategy_version = "v1";
  const insertedRows: any[] = [];
  const skipped: { symbol: string; reason: string }[] = [];

  for (const symbol of symbols) {
    // Pull bars only up to scanDate (global)
    const { data: bars, error: barErr } = await supabase
      .from("price_bars")
      .select("date, high, low, close, volume")
      .eq("symbol", symbol)
      .lte("date", scanDate)
      .order("date", { ascending: true });

    if (barErr || !bars || bars.length < 220) {
      skipped.push({
        symbol,
        reason: barErr?.message || "Not enough history (<220 bars) up to scanDate",
      });
      continue;
    }

    const cleaned: Bar[] = bars.map((b: any) => ({
      date: b.date,
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
    }));

    const closes = cleaned.map((b) => b.close);
    const highs = cleaned.map((b) => b.high);
    const lows = cleaned.map((b) => b.low);
    const vols = cleaned.map((b) => b.volume);

    const latestClose = closes[closes.length - 1];

    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    const rsi14 = rsi(closes, 14);
    const atr14 = atr(highs, lows, closes, 14);
    const vol20 = sma(vols, 20);
    const volSpike = vol20 ? vols[vols.length - 1] / vol20 : null;

    if (!sma20 || !sma50 || !sma200 || rsi14 === null || !atr14 || !volSpike) {
      skipped.push({ symbol, reason: "Indicator calc failed (null)" });
      continue;
    }

    // Score
    let score = 0;
    const above20 = latestClose > sma20;
    const above50 = latestClose > sma50;
    const above200 = latestClose > sma200;

    if (above20) score += 10;
    if (above50) score += 20;
    if (above200) score += 25;

    if (rsi14 >= 45 && rsi14 <= 65) score += 20;
    else if (rsi14 >= 35 && rsi14 < 45) score += 10;
    else if (rsi14 > 65 && rsi14 <= 75) score += 5;

    if (volSpike >= 1.5) score += 15;
    else if (volSpike >= 1.2) score += 8;

    const distFrom20 = Math.abs(latestClose - sma20);
    if (distFrom20 > 2 * atr14) score -= 10;

    score = clamp(score, 0, 100);

    // Signal
    let signal: "BUY" | "WATCH" | "AVOID" = "AVOID";
    const baseBuy =
      above50 && above200 && rsi14 >= 45 && rsi14 <= 70 && volSpike >= 1.1;

    if (baseBuy && score >= 60) signal = "BUY";
    else if (score >= 40) signal = "WATCH";

    if (regimeState === "DEFENSIVE" && signal === "BUY") {
      signal = "WATCH";
      score = clamp(score - 10, 0, 100);
    }

    // Trade levels
    const entry = latestClose;
    const stop = entry - 2 * atr14;
    const R = entry - stop;
    const tp1 = entry + 2 * R;
    const tp2 = entry + 3 * R;

    insertedRows.push({
      date: scanDate, // GLOBAL scan date
      universe_slug: "core_400",
      symbol,
      strategy_version,
      signal,
      confidence: Math.round(score),
      entry,
      stop,
      tp1,
      tp2,
      sma20,
      sma50,
      sma200,
      rsi14,
      atr14,
      vol_spike: volSpike,
    });
  }

  if (insertedRows.length > 0) {
    const { error: insErr } = await supabase.from("daily_scans").upsert(
      insertedRows,
      { onConflict: "date,universe_slug,symbol,strategy_version" }
    );

    if (insErr) {
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    scanDate,
    regime: regimeState,
    scanned: symbols.length,
    inserted: insertedRows.length,
    skipped: skipped.length,
    skippedDetails: skipped,
  });
}