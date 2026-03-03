import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_UNIVERSE = "liquid_2000";
const DEFAULT_VERSION = "v1";

const BUY_CAP = 5;
const WATCH_CAP = 10;

type ScanBody = {
  universe_slug?: string;
  version?: string;
  offset?: number;
  limit?: number;
  scan_date?: string; // YYYY-MM-DD (optional override)
};

type Bar = {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

// Wilder RSI (simplified, good enough for daily swing)
function rsi(closes: number[], period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function trueRange(curr: Bar, prev: Bar) {
  const hl = curr.high - curr.low;
  const hc = Math.abs(curr.high - prev.close);
  const lc = Math.abs(curr.low - prev.close);
  return Math.max(hl, hc, lc);
}

// ATR (simple average TR over N; stable enough for this use)
function atr(bars: Bar[], period = 14) {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    trs.push(trueRange(bars[i], bars[i - 1]));
  }
  const sum = trs.reduce((a, b) => a + b, 0);
  return sum / period;
}

function avgVolume(bars: Bar[], period = 20) {
  if (bars.length < period) return null;
  const slice = bars.slice(bars.length - period);
  const sum = slice.reduce((a, b) => a + (b.volume ?? 0), 0);
  return sum / period;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// Score + signal for “strict v1” (daily swing)
function scoreAndSignal(bars: Bar[]) {
  const closes = bars.map((b) => b.close);
  const latest = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);

  const sma50Prev = sma(closes.slice(0, closes.length - 1), 50);

  const r = rsi(closes, 14);
  const a = atr(bars, 14);
  const v20 = avgVolume(bars, 20);

  if (
    sma20 == null ||
    sma50 == null ||
    sma200 == null ||
    sma50Prev == null ||
    r == null ||
    a == null ||
    v20 == null
  ) {
    return null;
  }

  const above50 = latest.close > sma50;
  const above200 = latest.close > sma200;
  const sma50Rising = sma50 > sma50Prev;

  const volSpike = v20 > 0 ? latest.volume / v20 : 0;

  // “extension penalty”: dist from SMA20 > 2*ATR penalizes score
  const distFromSma20 = Math.abs(latest.close - sma20);
  const isExtended = distFromSma20 > 2 * a;

  // Base score (0..100)
  let score = 50;

  // Trend alignment
  if (above50) score += 10;
  else score -= 10;

  if (above200) score += 10;
  else score -= 10;

  if (sma50Rising) score += 10;
  else score -= 10;

  // RSI sweet spot 45–70
  if (r >= 45 && r <= 70) score += 15;
  else if (r < 40) score -= 10;
  else if (r > 75) score -= 10;

  // Volume confirmation
  if (volSpike >= 1.3) score += 10;
  else score -= 5;

  // Extension penalty
  if (isExtended) score -= 12;

  score = clamp(score, 0, 100);

  // Signal thresholds (tight)
  let signal: "BUY" | "WATCH" | "AVOID" = "AVOID";
  if (
    score >= 75 &&
    above50 &&
    above200 &&
    sma50Rising &&
    r >= 45 &&
    r <= 70 &&
    volSpike >= 1.3
  ) {
    signal = "BUY";
  } else if (score >= 60 && above50) {
    signal = "WATCH";
  }

  // Confidence: map score to 0..100 (but keep it “truthy”)
  const confidence = Math.round(score);

  const entry = latest.close;
  const stop = entry - 2 * a;
  const rMultiple = entry - stop; // = 2*ATR
  const tp1 = entry + 2 * rMultiple; // +2R
  const tp2 = entry + 3 * rMultiple; // +3R

  const reasons: string[] = [];
  reasons.push(above50 ? "Above SMA50" : "Below SMA50");
  reasons.push(above200 ? "Above SMA200" : "Below SMA200");
  reasons.push(sma50Rising ? "SMA50 rising" : "SMA50 not rising");
  reasons.push(`RSI ${r.toFixed(1)}`);
  reasons.push(`VolSpike ${volSpike.toFixed(2)}x`);
  if (isExtended) reasons.push("Extended vs SMA20 (penalty)");

  const reason_summary = reasons.join(" • ");
  const reason_json = {
    version: "v1-strict",
    latest: { date: latest.date, close: latest.close, volume: latest.volume },
    indicators: {
      sma20,
      sma50,
      sma200,
      rsi14: r,
      atr14: a,
      volAvg20: v20,
      volSpike,
      distFromSma20,
      extended: isExtended,
    },
    checks: {
      above50,
      above200,
      sma50Rising,
      rsiSweetSpot: r >= 45 && r <= 70,
      volSpikeOk: volSpike >= 1.3,
    },
    score,
    signal,
  };

  return {
    signal,
    confidence,
    entry,
    stop,
    tp1,
    tp2,
    reason_summary,
    reason_json,
    score,
  };
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars for admin client");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * GLOBAL CAP FINALIZER (per date + universe across ALL batches)
 *
 * Rules:
 * - Keep top BUY_CAP BUY (confidence desc, symbol asc)
 * - Remaining BUY become WATCH
 * - Keep top WATCH_CAP WATCH (from original WATCH + downgraded BUY)
 * - Remaining WATCH become AVOID
 */
async function enforceGlobalCaps(opts: {
  supabase: ReturnType<typeof admin>;
  date: string;
  universe_slug: string;
}) {
  const { supabase, date, universe_slug } = opts;

  // Pull only the rows that matter for capping
  const { data, error } = await supabase
    .from("daily_scans")
    .select("id,symbol,signal,confidence")
    .eq("date", date)
    .eq("universe_slug", universe_slug)
    .in("signal", ["BUY", "WATCH"]);

  if (error) throw error;
  if (!data || data.length === 0) return;

  // Stable sort: confidence desc, symbol asc
  const byRank = [...data].sort((a, b) => {
    const ac = Number(a.confidence ?? 0);
    const bc = Number(b.confidence ?? 0);
    if (bc !== ac) return bc - ac;
    return String(a.symbol).localeCompare(String(b.symbol));
  });

  // Separate current BUY and WATCH (still ranked same way)
  const buys = byRank.filter((r) => r.signal === "BUY");
  const watches = byRank.filter((r) => r.signal === "WATCH");

  const keepBuy = new Set(buys.slice(0, BUY_CAP).map((r) => r.id));

  // Downgrade extra BUY -> WATCH pool
  const downgradedBuyToWatch = buys.slice(BUY_CAP);

  // Now build WATCH pool = existing WATCH + downgraded BUY
  const watchPool = [...watches, ...downgradedBuyToWatch].sort((a, b) => {
    const ac = Number(a.confidence ?? 0);
    const bc = Number(b.confidence ?? 0);
    if (bc !== ac) return bc - ac;
    return String(a.symbol).localeCompare(String(b.symbol));
  });

  const keepWatch = new Set(watchPool.slice(0, WATCH_CAP).map((r) => r.id));

  // Determine updates
  const updates: Array<{ id: string; signal: "BUY" | "WATCH" | "AVOID" }> = [];

  for (const row of data) {
    const shouldBeBuy = keepBuy.has(row.id);
    const shouldBeWatch = !shouldBeBuy && keepWatch.has(row.id);

    let desired: "BUY" | "WATCH" | "AVOID" = "AVOID";
    if (shouldBeBuy) desired = "BUY";
    else if (shouldBeWatch) desired = "WATCH";

    if (row.signal !== desired) {
      updates.push({ id: row.id, signal: desired });
    }
  }

  if (updates.length === 0) return;

  // Bulk update via upsert on id (simple + reliable)
  const { error: upErr } = await supabase
    .from("daily_scans")
    .upsert(updates, { onConflict: "id" });

  if (upErr) throw upErr;
}

export async function POST(req: Request) {
  try {
    const supabase = admin();
    const body = (await req.json()) as ScanBody;

    const universe_slug = body.universe_slug ?? DEFAULT_UNIVERSE;
    const version = body.version ?? DEFAULT_VERSION;

    const offset = Number.isFinite(body.offset as number) ? Number(body.offset) : 0;
    const limit = Number.isFinite(body.limit as number) ? Number(body.limit) : 300;

    const scanDate = (body.scan_date && String(body.scan_date)) || isoDate();

    // Universe members (deterministic batching)
    const { data: universe, error: uErr } = await supabase
      .from("universes")
      .select("id,slug")
      .eq("slug", universe_slug)
      .single();

    if (uErr || !universe) {
      return NextResponse.json(
        { ok: false, error: `Universe not found: ${universe_slug}` },
        { status: 400 }
      );
    }

    const from = offset;
    const to = offset + limit - 1;

    const { data: members, error: mErr } = await supabase
      .from("universe_members")
      .select("symbol")
      .eq("universe_id", universe.id)
      .eq("active", true)
      .order("symbol", { ascending: true })
      .range(from, to);

    if (mErr) throw mErr;

    const symbols = (members ?? []).map((m) => m.symbol).filter(Boolean);

    if (symbols.length === 0) {
      // Still enforce caps in case earlier batches exist
      await enforceGlobalCaps({ supabase, date: scanDate, universe_slug });
      return NextResponse.json({
        ok: true,
        universe_slug,
        version,
        date: scanDate,
        offset,
        limit,
        processed: 0,
        upserted: 0,
        note: "No symbols in this batch range",
      });
    }

    // Fetch bars per symbol (last ~260 daily bars)
    // Note: This is intentionally simple. If you later want speed, we can batch-query + compute in memory.
    const upserts: any[] = [];
    let processed = 0;

    for (const symbol of symbols) {
      processed++;

      const { data: bars, error: bErr } = await supabase
        .from("price_bars")
        .select("date,open,high,low,close,volume")
        .eq("symbol", symbol)
        .eq("source", "polygon")
        .order("date", { ascending: true })
        .limit(260);

      if (bErr) continue;
      if (!bars || bars.length < 220) continue;

      const computed = scoreAndSignal(bars as Bar[]);
      if (!computed) continue;

      upserts.push({
        date: scanDate,
        universe_slug,
        version,
        symbol,
        signal: computed.signal,
        confidence: computed.confidence,
        entry: computed.entry,
        stop: computed.stop,
        tp1: computed.tp1,
        tp2: computed.tp2,
        reason_summary: computed.reason_summary,
        reason_json: computed.reason_json,
        updated_at: new Date().toISOString(),
      });
    }

    let upserted = 0;
    if (upserts.length > 0) {
      const { error: sErr, data: sData } = await supabase
        .from("daily_scans")
        .upsert(upserts, { onConflict: "date,universe_slug,symbol" })
        .select("id");

      if (sErr) throw sErr;
      upserted = sData?.length ?? 0;
    }

    // ✅ GLOBAL caps across ALL batches for this date/universe
    await enforceGlobalCaps({ supabase, date: scanDate, universe_slug });

    return NextResponse.json({
      ok: true,
      universe_slug,
      version,
      date: scanDate,
      offset,
      limit,
      processed,
      upserted,
      caps: { BUY: BUY_CAP, WATCH: WATCH_CAP },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}