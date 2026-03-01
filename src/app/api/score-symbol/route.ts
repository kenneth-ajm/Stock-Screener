import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  // Auth guard (so the endpoint isn’t public)
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

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const symbolRaw = String(body?.symbol ?? "").trim().toUpperCase();

  if (!symbolRaw) {
    return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
  }

  // Service role client for DB writes
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Align scoring date with the system: latest SPY date
  const { data: spyLatest, error: spyErr } = await supabase
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  if (spyErr || !spyLatest || spyLatest.length === 0) {
    return NextResponse.json(
      { ok: false, error: spyErr?.message || "No SPY bars found" },
      { status: 500 }
    );
  }

  const scanDate = String(spyLatest[0].date);

  // Regime
  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("date, state")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  const regimeState: "FAVORABLE" | "CAUTION" | "DEFENSIVE" =
    (regimeRows?.[0]?.state as any) ?? "CAUTION";

  // 1) Check if we already have enough bars
  const { data: existingBars } = await supabase
    .from("price_bars")
    .select("date, high, low, close, volume")
    .eq("symbol", symbolRaw)
    .lte("date", scanDate)
    .order("date", { ascending: true });

  let bars: any[] = existingBars ?? [];

  // 2) If not enough, fetch from Polygon and upsert into price_bars
  if (bars.length < 220) {
    const polygonKey = process.env.POLYGON_API_KEY;
    if (!polygonKey) {
      return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
    }

    // Fetch a generous window (~600 calendar days) to cover 220 trading days
    const to = new Date(scanDate);
    const from = new Date(to);
    from.setDate(from.getDate() - 650);

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbolRaw)}` +
      `/range/1/day/${toISODate(from)}/${toISODate(to)}` +
      `?adjusted=false&sort=asc&limit=50000&apiKey=${encodeURIComponent(polygonKey)}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `Polygon error for ${symbolRaw}: ${t || resp.status}` },
        { status: 500 }
      );
    }

    const json: any = await resp.json();
    const results: any[] = json?.results ?? [];

    if (!results.length) {
      return NextResponse.json({ ok: false, error: `No Polygon results for ${symbolRaw}` }, { status: 404 });
    }

    const upsertRows = results.map((r) => {
      const d = new Date(Number(r.t));
      return {
        symbol: symbolRaw,
        date: toISODate(d),
        open: Number(r.o),
        high: Number(r.h),
        low: Number(r.l),
        close: Number(r.c),
        volume: Number(r.v),
        source: "polygon",
      };
    });

    // Upsert into price_bars (assumes unique constraint on (symbol,date))
    const { error: upErr } = await supabase
      .from("price_bars")
      .upsert(upsertRows, { onConflict: "symbol,date" });

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    // Re-read bars up to scanDate
    const { data: reBars } = await supabase
      .from("price_bars")
      .select("date, high, low, close, volume")
      .eq("symbol", symbolRaw)
      .lte("date", scanDate)
      .order("date", { ascending: true });

    bars = reBars ?? [];
  }

  if (bars.length < 220) {
    return NextResponse.json(
      { ok: false, error: `Not enough history for ${symbolRaw} (have ${bars.length}, need ~220)` },
      { status: 400 }
    );
  }

  const cleaned: Bar[] = bars.map((b: any) => ({
    date: String(b.date),
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
    return NextResponse.json({ ok: false, error: "Indicator calc failed (null)" }, { status: 500 });
  }

  const above20 = latestClose > sma20;
  const above50 = latestClose > sma50;
  const above200 = latestClose > sma200;

  // Tightened BUY: SMA50 rising + volSpike >= 1.3
  const sma50Rising = prevSma50 ? sma50 > prevSma50 : false;

  // Score (same as scan)
  const breakdown: Array<{ k: string; pts: number }> = [];
  let score = 0;

  score += above20 ? 10 : 0;
  breakdown.push({ k: "Above SMA20", pts: above20 ? 10 : 0 });

  score += above50 ? 20 : 0;
  breakdown.push({ k: "Above SMA50", pts: above50 ? 20 : 0 });

  score += above200 ? 25 : 0;
  breakdown.push({ k: "Above SMA200", pts: above200 ? 25 : 0 });

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
  breakdown.push({ k: "Extension vs SMA20", pts: penalty });

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
    {
      ok: sma50Rising,
      label: "SMA50 rising",
      detail: prevSma50 ? `SMA50 ${sma50.toFixed(2)} vs prev ${prevSma50.toFixed(2)}` : "No prev SMA50",
    },
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
    indicators: { sma20, sma50, sma200, prevSma50, sma50Rising, rsi14, atr14, volSpike },
    levels: { entry, stop, tp1, tp2 },
  };

  return NextResponse.json({
    ok: true,
    symbol: symbolRaw,
    scanDate,
    signal,
    confidence: Math.round(score),
    entry,
    stop,
    tp1,
    tp2,
    reason_summary,
    reason_json,
  });
}