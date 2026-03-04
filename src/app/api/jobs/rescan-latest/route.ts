import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as scanPost } from "@/app/api/scan/route";

type Body = {
  universe_slug?: string;
  strategy_version?: string;
};

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY_VERSION = "v2_core_momentum";

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
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    weekday: get("weekday"),
  };
}

function prevWeekday(date: Date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function lastCompletedUsTradingDay(now = new Date()) {
  const ny = getNyParts(now);
  const utcDateFromNy = new Date(Date.UTC(ny.year, ny.month - 1, ny.day));
  if (ny.weekday === "Sat") return ymd(prevWeekday(utcDateFromNy));
  if (ny.weekday === "Sun") return ymd(prevWeekday(prevWeekday(utcDateFromNy)));
  if (ny.hour < 18) return ymd(prevWeekday(utcDateFromNy));
  return ymd(utcDateFromNy);
}

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

async function refreshSpyRegimeForDate(dateUsed: string) {
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as any;

  const { data: bars, error } = await supa
    .from("price_bars")
    .select("date,close")
    .eq("symbol", "SPY")
    .lte("date", dateUsed)
    .order("date", { ascending: false })
    .limit(260);
  if (error) throw new Error(error.message ?? "Failed to read SPY bars");
  if (!Array.isArray(bars) || bars.length < 200) throw new Error("Not enough SPY bars to compute regime");

  const latest = bars[0];
  if (!latest || String(latest.date) !== dateUsed) {
    throw new Error(`SPY bar missing for ${dateUsed}`);
  }

  const asc = [...bars].reverse();
  const closes = asc.map((b: any) => Number(b.close));
  const sma200 = sma(closes, 200);
  if (!sma200) throw new Error("Unable to compute SPY SMA200");
  const close = Number(latest.close);
  const state = close > sma200 ? "FAVORABLE" : "DEFENSIVE";

  const { error: upErr } = await supa.from("market_regime").upsert(
    {
      symbol: "SPY",
      date: dateUsed,
      close,
      sma200,
      state,
    },
    { onConflict: "symbol,date" }
  );
  if (upErr) throw new Error(upErr.message ?? "Failed to upsert market regime");
  return state;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const universe_slug = String(body?.universe_slug ?? DEFAULT_UNIVERSE).trim() || DEFAULT_UNIVERSE;
    const strategy_version =
      String(body?.strategy_version ?? DEFAULT_STRATEGY_VERSION).trim() || DEFAULT_STRATEGY_VERSION;
    const date_used = lastCompletedUsTradingDay();
    const regime_state = await refreshSpyRegimeForDate(date_used);

    const scanReq = new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        universe_slug,
        strategy_version,
        scan_date: date_used,
        offset: 0,
        limit: 1200,
      }),
    });

    const scanRes = await scanPost(scanReq);
    const scanJson = await scanRes.json().catch(() => null);
    if (!scanRes.ok || !scanJson?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: scanJson?.error ?? `Scan failed with status ${scanRes.status}`,
          detail: scanJson?.detail ?? scanJson ?? null,
        },
        { status: scanRes.status || 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      universe_slug,
      strategy_version,
      date_used,
      regime_state,
      processed: scanJson?.processed ?? 0,
      scored: scanJson?.scored ?? 0,
      upserted: scanJson?.upserted ?? 0,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e: unknown) {
    console.error("rescan-latest error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
