import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const DEFAULT_UNIVERSE_SLUG = "growth_1500";
const TARGET_COUNT = 1500;
const MIN_PRICE = 5;
const MIN_AVG_DOLLAR_VOLUME_20D = 5_000_000;
const MIN_MARKET_CAP = 1_000_000_000;

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function previousWeekday(from: Date) {
  const d = new Date(from);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

type GroupedRow = {
  T: string;
  c: number;
  v: number;
};

async function fetchGroupedDate(apiKey: string, date: string) {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(
    date
  )}?adjusted=false&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Polygon grouped failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => null)) as { results?: GroupedRow[] } | null;
  return Array.isArray(json?.results) ? json.results : [];
}

async function fetchEligibleUsCommonSet(apiKey: string) {
  const out = new Set<string>();
  let nextUrl: string | null =
    `https://api.polygon.io/v3/reference/tickers?market=stocks&locale=us&active=true&type=CS` +
    `&market_cap.gte=${MIN_MARKET_CAP}&limit=1000&sort=ticker&order=asc&apiKey=${encodeURIComponent(apiKey)}`;
  let pages = 0;
  while (nextUrl && pages < 30) {
    pages += 1;
    const res = await fetch(nextUrl, { cache: "no-store" });
    if (!res.ok) break;
    const json = (await res.json().catch(() => null)) as
      | { results?: Array<{ ticker?: string | null }>; next_url?: string | null }
      | null;
    for (const row of json?.results ?? []) {
      const symbol = String(row?.ticker ?? "").trim().toUpperCase();
      if (symbol) out.add(symbol);
    }
    const rawNext = json?.next_url ? String(json.next_url) : "";
    nextUrl = rawNext
      ? `${rawNext}${rawNext.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`
      : null;
  }
  return out;
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function computeAvgDollarVolume20BySymbol(
  supabase: any,
  symbols: string[],
  scanDate: string
) {
  const from = new Date(`${scanDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 45);
  const fromDate = isoDate(from);
  const map = new Map<string, number>();

  for (let i = 0; i < symbols.length; i += 300) {
    const chunk = symbols.slice(i, i + 300);
    const { data } = await supabase
      .from("price_bars")
      .select("symbol,date,close,volume,source")
      .in("symbol", chunk)
      .eq("source", "polygon")
      .gte("date", fromDate)
      .lte("date", scanDate)
      .order("date", { ascending: true });
    const perSymbol = new Map<string, number[]>();
    for (const row of data ?? []) {
      const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
      const close = Number((row as any)?.close);
      const volume = Number((row as any)?.volume);
      if (!symbol || !Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume <= 0) continue;
      if (!perSymbol.has(symbol)) perSymbol.set(symbol, []);
      perSymbol.get(symbol)!.push(close * volume);
    }
    for (const [symbol, values] of perSymbol.entries()) {
      const last20 = values.slice(-20);
      if (last20.length >= 20) map.set(symbol, avg(last20));
    }
  }

  return map;
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const universeSlug =
      typeof body.universe_slug === "string" && body.universe_slug.trim()
        ? body.universe_slug.trim()
        : DEFAULT_UNIVERSE_SLUG;
    const scanDate = typeof body.date === "string" && body.date ? body.date : isoDate(previousWeekday(new Date()));
    const cap = Number.isFinite(Number(body.limit)) ? Math.max(200, Math.min(2500, Number(body.limit))) : TARGET_COUNT;

    const grouped = await fetchGroupedDate(apiKey, scanDate);
    const ranked = grouped
      .map((r) => {
        const symbol = String(r?.T ?? "").trim().toUpperCase();
        const close = Number(r?.c);
        const volume = Number(r?.v);
        const dollar = Number.isFinite(close) && close > 0 && Number.isFinite(volume) && volume > 0 ? close * volume : 0;
        return { symbol, close, volume, dollar };
      })
      .filter((r) => r.symbol && r.close > MIN_PRICE && r.volume > 0 && r.dollar > 0)
      .sort((a, b) => b.dollar - a.dollar)
      .slice(0, 6000);

    const usCommon = await fetchEligibleUsCommonSet(apiKey);
    const candidateSymbols = ranked
      .filter((r) => usCommon.has(r.symbol))
      .map((r) => r.symbol);

    const adv20Map = await computeAvgDollarVolume20BySymbol(supabase as any, candidateSymbols, scanDate);
    const finalSymbols = ranked
      .filter((r) => usCommon.has(r.symbol))
      .filter((r) => (adv20Map.get(r.symbol) ?? 0) >= MIN_AVG_DOLLAR_VOLUME_20D)
      .slice(0, cap)
      .map((r) => r.symbol);

    if (finalSymbols.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No symbols passed growth_1500 filters",
        date: scanDate,
      });
    }

    const { data: existingUniverse } = await supabase
      .from("universes")
      .select("id,slug")
      .eq("slug", universeSlug)
      .maybeSingle();
    let universeId = existingUniverse?.id ?? null;

    if (!universeId) {
      const { data: created, error: createErr } = await supabase
        .from("universes")
        .insert({
          slug: universeSlug,
          name: "Growth 1500 (US common, >$1B mcap, >$5M ADV20, price>$5)",
        })
        .select("id")
        .maybeSingle();
      if (createErr || !created?.id) {
        return NextResponse.json({ ok: false, error: createErr?.message ?? "Failed creating universe" }, { status: 500 });
      }
      universeId = created.id;
    }

    await supabase.from("universe_members").update({ active: false }).eq("universe_id", universeId);
    const memberRows = finalSymbols.map((symbol) => ({ universe_id: universeId, symbol, active: true }));
    const { error: memberErr } = await supabase.from("universe_members").upsert(memberRows, {
      onConflict: "universe_id,symbol",
    });
    if (memberErr) {
      return NextResponse.json({ ok: false, error: memberErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      universe_slug: universeSlug,
      universe_id: universeId,
      date: scanDate,
      count: finalSymbols.length,
      filters: {
        market_cap_gt: MIN_MARKET_CAP,
        avg_dollar_volume_20d_gt: MIN_AVG_DOLLAR_VOLUME_20D,
        price_gt: MIN_PRICE,
        us_only: true,
        exclude_etf: true,
      },
      top10: finalSymbols.slice(0, 10),
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
