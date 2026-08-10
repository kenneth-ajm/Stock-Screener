import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { MIDCAP_UNIVERSE_SLUG } from "@/lib/strategy_universe";
import {
  fetchActiveUsCommonSymbols,
  fetchPolygonMarketCaps,
  loadAverageDollarVolume20,
} from "@/lib/universe_reference";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TARGET_COUNT = 1000;
const MIN_PRICE = 5;
const MIN_AVG_DOLLAR_VOLUME_20D = 5_000_000;
const MIN_MARKET_CAP = 2_000_000_000;
const MAX_MARKET_CAP = 20_000_000_000;

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function previousWeekday(from: Date) {
  const d = new Date(from);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

type GroupedRow = { T: string; c: number; v: number };

async function fetchGroupedDate(apiKey: string, date: string) {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(
    date
  )}?adjusted=false&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Polygon grouped failed (${res.status})`);
  const json = (await res.json().catch(() => null)) as { results?: GroupedRow[] } | null;
  return Array.isArray(json?.results) ? json.results : [];
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
    if (!supabaseUrl || !serviceKey) return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 });

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const universeSlug =
      typeof body.universe_slug === "string" && body.universe_slug.trim()
        ? body.universe_slug.trim()
        : MIDCAP_UNIVERSE_SLUG;
    const scanDate = typeof body.date === "string" && body.date ? body.date : isoDate(previousWeekday(new Date()));
    const cap = Number.isFinite(Number(body.limit)) ? Math.max(200, Math.min(1500, Number(body.limit))) : TARGET_COUNT;

    const grouped = await fetchGroupedDate(apiKey, scanDate);
    const rankedBySymbol = new Map<string, { symbol: string; close: number; volume: number; dollar: number }>();
    for (const r of grouped) {
        const symbol = String(r?.T ?? "").trim().toUpperCase();
        const close = Number(r?.c);
        const volume = Number(r?.v);
        const dollar = Number.isFinite(close) && close > 0 && Number.isFinite(volume) && volume > 0 ? close * volume : 0;
        if (symbol && close > MIN_PRICE && volume > 0 && dollar > 0) {
          rankedBySymbol.set(symbol, { symbol, close, volume, dollar });
        }
    }
    const ranked = Array.from(rankedBySymbol.values())
      .sort((a, b) => b.dollar - a.dollar)
      .slice(0, 5000);

    const usCommon = await fetchActiveUsCommonSymbols(apiKey);
    const candidateSymbols = ranked.filter((r) => usCommon.has(r.symbol)).map((r) => r.symbol);
    const adv20 = await loadAverageDollarVolume20({
      supabase,
      symbols: candidateSymbols,
      scanDate,
    });
    const liquidCandidates = ranked
      .filter((r) => usCommon.has(r.symbol) && (adv20.get(r.symbol) ?? 0) >= MIN_AVG_DOLLAR_VOLUME_20D)
      .map((r) => r.symbol);
    const marketCaps = await fetchPolygonMarketCaps(apiKey, liquidCandidates);
    const finalSymbols = liquidCandidates
      .filter((symbol) => {
        const marketCap = marketCaps.get(symbol) ?? 0;
        return marketCap >= MIN_MARKET_CAP && marketCap <= MAX_MARKET_CAP;
      })
      .slice(0, cap);

    if (!finalSymbols.length) {
      return NextResponse.json({ ok: false, error: "No symbols passed midcap_1000 filters", date: scanDate });
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
          name: "Midcap 1000 (US common, $2B-$20B mcap, >$5M ADV20, price>$5)",
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
      candidates_with_liquidity: liquidCandidates.length,
      candidates_with_market_cap: marketCaps.size,
      filters: {
        market_cap_gte: MIN_MARKET_CAP,
        market_cap_lte: MAX_MARKET_CAP,
        avg_dollar_volume_20d_gt: MIN_AVG_DOLLAR_VOLUME_20D,
        price_gt: MIN_PRICE,
        us_only: true,
        exclude_etf: true,
      },
      top10: finalSymbols.slice(0, 10),
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
