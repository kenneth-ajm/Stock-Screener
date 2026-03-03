import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as scanPost } from "@/app/api/scan/route";

const UNIVERSE_SLUG = "core_800";

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getNyParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    weekday: get("weekday"), // Mon Tue ...
  };
}

function prevWeekday(date: Date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d;
}

function lastCompletedUsTradingDay(now = new Date()) {
  const ny = getNyParts(now);
  const utcDateFromNy = new Date(Date.UTC(ny.year, ny.month - 1, ny.day));

  // Weekend handling first
  if (ny.weekday === "Sat") return ymd(prevWeekday(utcDateFromNy));
  if (ny.weekday === "Sun") return ymd(prevWeekday(prevWeekday(utcDateFromNy)));

  // If before ~18:00 NY, treat previous weekday as "completed"
  if (ny.hour < 18) return ymd(prevWeekday(utcDateFromNy));
  return ymd(utcDateFromNy);
}

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

async function ingestGroupedForDate(opts: {
  supabase: ReturnType<typeof createClient>;
  date: string;
  symbols: string[];
}) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("Missing POLYGON_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const groupedUrl = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(
    opts.date
  )}?adjusted=false&apiKey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(groupedUrl, { cache: "no-store", signal: controller.signal }).finally(() =>
    clearTimeout(timeout)
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Polygon grouped fetch failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const json = (await res.json().catch(() => null)) as
    | { results?: Array<Record<string, unknown>> }
    | null;
  const groupedRows = Array.isArray(json?.results) ? json.results : [];

  const symbolSet = new Set(opts.symbols);
  const upserts: Array<{
    symbol: string;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source: string;
  }> = [];

  for (const row of groupedRows) {
    const symbol = String(row.T ?? "").toUpperCase();
    if (!symbolSet.has(symbol)) continue;
    const open = Number(row.o);
    const high = Number(row.h);
    const low = Number(row.l);
    const close = Number(row.c);
    const volume = Number(row.v);
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }
    upserts.push({
      symbol,
      date: opts.date,
      open,
      high,
      low,
      close,
      volume: Math.round(volume),
      source: "polygon",
    });
  }

  if (upserts.length === 0) return 0;

  const chunkSize = 400;
  let written = 0;
  for (let i = 0; i < upserts.length; i += chunkSize) {
    const chunk = upserts.slice(i, i + chunkSize);
    const { error } = await opts.supabase.from("price_bars").upsert(chunk, {
      onConflict: "symbol,date",
    });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

async function updateSpyRegimeForDate(opts: {
  supabase: ReturnType<typeof createClient>;
  date: string;
}) {
  const { data: bars, error } = await opts.supabase
    .from("price_bars")
    .select("date,close")
    .eq("symbol", "SPY")
    .lte("date", opts.date)
    .order("date", { ascending: false })
    .limit(260);
  if (error || !bars || bars.length < 200) {
    throw new Error(error?.message || "Not enough SPY bars to compute regime");
  }

  const latest = bars[0];
  if (String(latest.date) !== opts.date) {
    throw new Error(`SPY bar missing for ${opts.date}`);
  }

  const asc = [...bars].reverse();
  const closes = asc.map((b) => Number(b.close));
  const sma200 = sma(closes, 200);
  if (!sma200) throw new Error("Unable to compute SPY SMA200");
  const close = Number(latest.close);
  const state = close > sma200 ? "FAVORABLE" : "DEFENSIVE";

  const { error: upErr } = await opts.supabase.from("market_regime").upsert({
    symbol: "SPY",
    date: opts.date,
    close,
    sma200,
    state,
  });
  if (upErr) throw upErr;
  return state;
}

async function runAutopilot() {
  const startedAt = Date.now();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const dateUsed = lastCompletedUsTradingDay();

  const { data: universe, error: universeErr } = await supabase
    .from("universes")
    .select("id")
    .eq("slug", UNIVERSE_SLUG)
    .maybeSingle();
  if (universeErr) throw new Error(universeErr.message);
  if (!universe?.id) throw new Error(`Universe not found: ${UNIVERSE_SLUG}`);

  const { data: members, error: membersErr } = await supabase
    .from("universe_members")
    .select("symbol")
    .eq("universe_id", universe.id)
    .eq("active", true)
    .order("symbol", { ascending: true });
  if (membersErr) throw new Error(membersErr.message);
  const symbols = (members ?? []).map((m) => String(m.symbol ?? "").toUpperCase()).filter(Boolean);

  const barsUpserted = await ingestGroupedForDate({ supabase, date: dateUsed, symbols });
  const regimeState = await updateSpyRegimeForDate({ supabase, date: dateUsed });

  const scanReq = new Request("http://localhost/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      universe_slug: UNIVERSE_SLUG,
      strategy_version: "v2_core_momentum",
      scan_date: dateUsed,
      offset: 0,
      limit: 1200,
    }),
  });
  const scanRes = await scanPost(scanReq);
  const scanJson = await scanRes.json().catch(() => null);
  if (!scanRes.ok || !scanJson?.ok) {
    throw new Error(scanJson?.error || `Scan failed with status ${scanRes.status}`);
  }

  const { data: counts, error: countErr } = await supabase
    .from("daily_scans")
    .select("signal")
    .eq("universe_slug", UNIVERSE_SLUG)
    .eq("strategy_version", "v2_core_momentum")
    .eq("date", dateUsed)
    .in("signal", ["BUY", "WATCH"]);
  if (countErr) throw new Error(countErr.message);

  const buyCount = (counts ?? []).filter((r) => r.signal === "BUY").length;
  const watchCount = (counts ?? []).filter((r) => r.signal === "WATCH").length;

  return {
    ok: true,
    date_used: dateUsed,
    bars_upserted: barsUpserted,
    regime_state: regimeState,
    scan_upserted: scanJson?.upserted ?? 0,
    buy_count: buyCount,
    watch_count: watchCount,
    duration_ms: Date.now() - startedAt,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await runAutopilot());
  } catch (e: unknown) {
    console.error("daily-autopilot error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
