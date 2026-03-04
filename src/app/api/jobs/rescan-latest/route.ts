import { NextResponse } from "next/server";
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

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const universe_slug = String(body?.universe_slug ?? DEFAULT_UNIVERSE).trim() || DEFAULT_UNIVERSE;
    const strategy_version =
      String(body?.strategy_version ?? DEFAULT_STRATEGY_VERSION).trim() || DEFAULT_STRATEGY_VERSION;
    const date_used = lastCompletedUsTradingDay();

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

