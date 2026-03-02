import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Bar = { date: string; high: number; low: number; close: number; volume: number };

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}
function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
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
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type WhyLine = { ok: boolean; label: string; detail?: string };
function summarizeWhy(lines: WhyLine[]) {
  const okCount = lines.filter((l) => l.ok).length;
  const bad = lines.filter((l) => !l.ok).map((l) => l.label);
  const blockers = bad.slice(0, 2).join(", ");
  if (!bad.length) return `Strong setup (${okCount}/${lines.length} checks passed).`;
  return `Mixed setup (${okCount}/${lines.length} checks). Missing: ${blockers}.`;
}

async function finalizeCaps(supabase: any, scanDate: string) {
  // Global caps per day
  const BUY_CAP = 5;
  const WATCH_CAP = 10;

  const { data: rows, error } = await supabase
    .from("daily_scans")
    .select("symbol, signal, confidence")
    .eq("date", scanDate)
    .eq("universe_slug", "liquid_2000")
    .eq("strategy_version", "v1");

  if (error) return { ok: false, error: error.message };

  const buy = (rows ?? []).filter((r: any) => r.signal === "BUY").sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const watch = (rows ?? []).filter((r: any) => r.signal === "WATCH").sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));

  const keepBuy = new Set(buy.slice(0, BUY_CAP).map((r: any) => r.symbol));
  const keepWatch = new Set(watch.slice(0, WATCH_CAP).map((r: any) => r.symbol));

  const updates: any[] = [];
  for (const r of rows ?? []) {
    if (r.signal === "BUY" && !keepBuy.has(r.symbol)) {
      updates.push({ date: scanDate, universe_slug: "liquid_2000", symbol: r.symbol, strategy_version: "v1", signal: "WATCH" });
    }
  }

  // Recompute WATCH after buy downgrades (we’ll just cap overall WATCH set)
  // Fetch again quickly is fine at this scale; keep simple.
  const { data: rows2 } = await supabase
    .from("daily_scans")
    .select("symbol, signal, confidence")
    .eq("date", scanDate)
    .eq("universe_slug", "liquid_2000")
    .eq("strategy_version", "v1");

  const watch2 = (rows2 ?? []).filter((r: any) => r.signal === "WATCH").sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const keepWatch2 = new Set(watch2.slice(0, WATCH_CAP).map((r: any) => r.symbol));

  for (const r of rows2 ?? []) {
    if (r.signal === "WATCH" && !keepWatch2.has(r.symbol)) {
      updates.push({ date: scanDate, universe_slug: "liquid_2000", symbol: r.symbol, strategy_version: "v1", signal: "AVOID" });
    }
  }

  if (updates.length) {
    const { error: upErr } = await supabase.from("daily_scans").upsert(updates, {
      onConflict: "date,universe_slug,symbol,strategy_version",
    });
    if (upErr) return { ok: false, error: upErr.message };
  }

  return { ok: true, buy_cap: BUY_CAP, watch_cap: WATCH_CAP };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const universe_slug = (body?.universe_slug ?? "liquid_2000").toString();
  const limit = typeof body?.limit === "number" ? Math.max(1, Math.min(600, body.limit)) : 300;
  const offset = typeof body?.offset === "number" ? Math.max(0, body.offset) : 0;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Scan date
  const { data: spyLatest, error: spyErr } = await supabase
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  if (spyErr || !spyLatest?.length) {
    return NextResponse.json({ ok: false, error: spyErr?.message || "No SPY bars found" }, { status: 500 });
  }
  const scanDate = spyLatest[0].date as string;

  // Regime
  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("state")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  const regimeState: "FAVORABLE" | "CAUTION" | "DEFENSIVE" =
    (regimeRows?.[0]?.state as any) ?? "CAUTION";

  // Universe union (liquid_2000 includes core_400)
  const slugs = universe_slug === "liquid_2000" ? ["liquid_2000", "core_400"] : [universe_slug];

  const { data: members, error: memErr } = await supabase
    .from("universe_members")
    .select("symbol, universes!inner(slug)")
    .in("universes.slug", slugs)
    .eq("active", true)
    .order("symbol", { ascending: true });

  if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });

  const allSymbols = Array.from(
    new Set((members ?? []).map((m: any) => String(m.symbol).toUpperCase()).filter(Boolean))
  );

  const batch = allSymbols.slice(offset, offset + limit);

  const insertedRows: any[] = [];
  const skipped: { symbol: string; reason: string }[] = [];

  for (const symbol of batch) {
    const { data: bars, error: barErr } = await supabase
      .from("price_bars")
      .select("date, high, low, close, volume")
      .eq("symbol", symbol)
      .lte("date", scanDate)
      .order("date", { ascending: true });

    if (barErr || !bars || bars.length < 220) {
      skipped.push({ symbol, reason: barErr?.message || "Not enough history (<220 bars)" });
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
    const prevSma50 = sma(closes.slice(0, -1), 50);

    const rsi14 = rsi(closes, 14);
    const atr14 = atr(highs, lows, closes, 14);
    const vol20 = sma(vols, 20);
    const volSpike = vol20 ? vols[vols.length - 1] / vol20 : null;

    if (!sma20 || !sma50 || !sma200 || rsi14 === null || !atr14 || !volSpike) {
      skipped.push({ symbol, reason: "Indicator calc failed (null)" });
      continue;
    }

    const above20 = latestClose > sma20;
    const above50 = latestClose > sma50;
    const above200 = latestClose > sma200;
    const sma50Rising = prevSma50 ? sma50 > prevSma50 : false;

    // score
    let score = 0;
    score += above20 ? 10 : 0;
    score += above50 ? 20 : 0;
    score += above200 ? 25 : 0;

    // RSI
    let rsiPts = 0;
    if (rsi14 >= 45 && rsi14 <= 65) rsiPts = 20;
    else if (rsi14 >= 35 && rsi14 < 45) rsiPts = 10;
    else if (rsi14 > 65 && rsi14 <= 75) rsiPts = 5;
    score += rsiPts;

    // volume
    let volPts = 0;
    if (volSpike >= 1.5) volPts = 15;
    else if (volSpike >= 1.2) volPts = 8;
    score += volPts;

    // extension penalty
    const distFrom20 = Math.abs(latestClose - sma20);
    if (distFrom20 > 2 * atr14) score -= 10;

    // SMA50 rising bonus (and required for BUY)
    if (sma50Rising) score += 5;

    score = clamp(score, 0, 100);

    let signal: "BUY" | "WATCH" | "AVOID" = "AVOID";

    const baseBuy =
      above50 &&
      above200 &&
      sma50Rising &&
      rsi14 >= 45 &&
      rsi14 <= 70 &&
      volSpike >= 1.3;

    // tight thresholds
    if (baseBuy && score >= 75) signal = "BUY";
    else if (score >= 50) signal = "WATCH";

    if (regimeState === "DEFENSIVE" && signal === "BUY") {
      signal = "WATCH";
      score = clamp(score - 10, 0, 100);
    }

    const entry = latestClose;
    const stop = entry - 2 * atr14;
    const R = entry - stop;
    const tp1 = entry + 2 * R;
    const tp2 = entry + 3 * R;

    const whyLines: WhyLine[] = [
      { ok: above200, label: "Above SMA200" },
      { ok: above50, label: "Above SMA50" },
      { ok: sma50Rising, label: "SMA50 rising" },
      { ok: above20, label: "Above SMA20" },
      { ok: rsi14 >= 45 && rsi14 <= 70, label: "RSI healthy" },
      { ok: volSpike >= 1.3, label: "Volume confirms" },
      { ok: true, label: "Regime", detail: regimeState },
    ];

    insertedRows.push({
      date: scanDate,
      universe_slug: "liquid_2000",
      symbol,
      strategy_version: "v1",
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
      reason_summary: summarizeWhy(whyLines),
      reason_json: { checks: whyLines, regime: regimeState },
    });
  }

  if (insertedRows.length) {
    const { error: upErr } = await supabase.from("daily_scans").upsert(insertedRows, {
      onConflict: "date,universe_slug,symbol,strategy_version",
    });
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  // ✅ global caps
  const capRes = await finalizeCaps(supabase, scanDate);

  return NextResponse.json({
    ok: true,
    scanDate,
    universe_slug: "liquid_2000",
    regime: regimeState,
    scanned: batch.length,
    inserted: insertedRows.length,
    skipped: skipped.length,
    batch_offset: offset,
    batch_limit: limit,
    caps: capRes,
  });
}