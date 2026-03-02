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

type WhyLine = { ok: boolean; label: string; detail?: string };

function summarizeWhy(lines: WhyLine[]) {
  const okCount = lines.filter((l) => l.ok).length;
  const bad = lines.filter((l) => !l.ok).map((l) => l.label);
  const blockers = bad.slice(0, 2).join(", ");
  if (!bad.length) return `Strong setup (${okCount}/${lines.length} checks passed).`;
  return `Mixed setup (${okCount}/${lines.length} checks). Missing: ${blockers}.`;
}

export async function GET() {
  return NextResponse.json({
    ok: false,
    message: "Use POST. Go to /screener and click 'Run Daily Scan'.",
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const universe_slug = (body?.universe_slug ?? "core_400").toString();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1) Global scan date = latest SPY date
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

  // 3) Universe members (dynamic)
  const { data: members, error: memErr } = await supabase
    .from("universe_members")
    .select("symbol, active, universe_id, universes!inner(slug)")
    .eq("universes.slug", universe_slug)
    .eq("active", true);

  if (memErr) {
    return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  }

  const symbols = (members ?? []).map((m: any) => String(m.symbol).toUpperCase());
  if (symbols.length === 0) {
    return NextResponse.json({ ok: false, error: `No symbols in ${universe_slug}` });
  }

  const strategy_version = "v1";
  const insertedRows: any[] = [];
  const skipped: { symbol: string; reason: string }[] = [];

  for (const symbol of symbols) {
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

    const breakdown: Array<{ k: string; pts: number }> = [];
    let score = 0;

    if (above20) {
      score += 10; breakdown.push({ k: "Above SMA20", pts: 10 });
    } else breakdown.push({ k: "Above SMA20", pts: 0 });

    if (above50) {
      score += 20; breakdown.push({ k: "Above SMA50", pts: 20 });
    } else breakdown.push({ k: "Above SMA50", pts: 0 });

    if (above200) {
      score += 25; breakdown.push({ k: "Above SMA200", pts: 25 });
    } else breakdown.push({ k: "Above SMA200", pts: 0 });

    let rsiPts = 0;
    if (rsi14 >= 45 && rsi14 <= 65) rsiPts = 20;
    else if (rsi14 >= 35 && rsi14 < 45) rsiPts = 10;
    else if (rsi14 > 65 && rsi14 <= 75) rsiPts = 5;
    score += rsiPts;
    breakdown.push({ k: `RSI ${rsi14.toFixed(1)}`, pts: rsiPts });

    let volPts = 0;
    if (volSpike >= 1.5) volPts = 15;
    else if (volSpike >= 1.2) volPts = 8;
    score += volPts;
    breakdown.push({ k: `Volume spike ${volSpike.toFixed(2)}x`, pts: volPts });

    const distFrom20 = Math.abs(latestClose - sma20);
    let penalty = 0;
    if (distFrom20 > 2 * atr14) penalty = -10;
    score += penalty;
    breakdown.push({ k: `Extension vs SMA20`, pts: penalty });

    score = clamp(score, 0, 100);

    let signal: "BUY" | "WATCH" | "AVOID" = "AVOID";

    const baseBuy =
      above50 &&
      above200 &&
      sma50Rising &&
      rsi14 >= 45 &&
      rsi14 <= 70 &&
      volSpike >= 1.3;

    if (baseBuy && score >= 60) signal = "BUY";
    else if (score >= 40) signal = "WATCH";

    const downgraded = regimeState === "DEFENSIVE" && signal === "BUY";
    if (downgraded) {
      signal = "WATCH";
      score = clamp(score - 10, 0, 100);
    }

    const entry = latestClose;
    const stop = entry - 2 * atr14;
    const R = entry - stop;
    const tp1 = entry + 2 * R;
    const tp2 = entry + 3 * R;

    const whyLines: WhyLine[] = [
      { ok: above200, label: "Above SMA200", detail: `close ${entry.toFixed(2)} vs ${sma200.toFixed(2)}` },
      { ok: above50, label: "Above SMA50", detail: `close ${entry.toFixed(2)} vs ${sma50.toFixed(2)}` },
      { ok: sma50Rising, label: "SMA50 rising", detail: prevSma50 ? `SMA50 ${sma50.toFixed(2)} vs prev ${prevSma50.toFixed(2)}` : "Not enough data" },
      { ok: above20, label: "Above SMA20", detail: `close ${entry.toFixed(2)} vs ${sma20.toFixed(2)}` },
      { ok: rsi14 >= 45 && rsi14 <= 70, label: "RSI healthy", detail: `RSI ${rsi14.toFixed(1)} (45–70)` },
      { ok: volSpike >= 1.3, label: "Volume confirms", detail: `${volSpike.toFixed(2)}x (need ≥ 1.30x)` },
      { ok: !downgraded, label: "Regime allows aggression", detail: `SPY regime: ${regimeState}` },
    ];

    const reason_summary = summarizeWhy(whyLines);

    const reason_json = {
      regime: regimeState,
      downgraded_buy_to_watch: downgraded,
      checks: whyLines,
      score_breakdown: breakdown,
      indicators: { sma20, sma50, sma200, rsi14, atr14, volSpike, prevSma50, sma50Rising },
      levels: { entry, stop, tp1, tp2 },
    };

    insertedRows.push({
      date: scanDate,
      universe_slug,
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
      reason_summary,
      reason_json,
    });
  }

  if (insertedRows.length > 0) {
    const { error: insErr } = await supabase.from("daily_scans").upsert(insertedRows, {
      onConflict: "date,universe_slug,symbol,strategy_version",
    });

    if (insErr) {
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    scanDate,
    regime: regimeState,
    universe_slug,
    scanned: symbols.length,
    inserted: insertedRows.length,
    skipped: skipped.length,
    skippedDetails: skipped.slice(0, 50),
    note:
      universe_slug === "liquid_2000"
        ? "If inserted is low, run the liquid_2000 ingest endpoint to populate price_bars history."
        : undefined,
  });
}