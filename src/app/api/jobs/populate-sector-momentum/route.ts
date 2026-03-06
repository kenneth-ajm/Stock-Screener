import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLCTD } from "@/lib/scan_date";
import {
  computeSectorMomentumCandidates,
  SECTOR_MOMENTUM_STRATEGY_VERSION,
  type SectorMomentumCandidate,
} from "@/lib/sector_momentum";
import { GROWTH_UNIVERSE_SLUG } from "@/lib/strategy_universe";

const TARGET_GROWTH_COUNT = 1500;
const MIN_PRICE = 5;
const MIN_AVG_DOLLAR_VOLUME_20D = 5_000_000;
type LiquidityRow = { symbol: string; close: number; volume: number; dollar: number };

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function ensureGrowthUniverseFromExistingBars(supabase: any, scanDate: string) {
  const { data: existingUniverse } = await supabase
    .from("universes")
    .select("id,slug")
    .eq("slug", GROWTH_UNIVERSE_SLUG)
    .maybeSingle();
  let universeId = existingUniverse?.id ?? null;

  if (!universeId) {
    const { data: created, error: createErr } = await supabase
      .from("universes")
      .insert({
        slug: GROWTH_UNIVERSE_SLUG,
        name: "Growth 1500 (derived from existing price_bars)",
      })
      .select("id")
      .maybeSingle();
    if (createErr || !created?.id) {
      throw new Error(createErr?.message ?? "Failed creating growth_1500 universe");
    }
    universeId = created.id;
  }

  const { count: currentActive } = await supabase
    .from("universe_members")
    .select("symbol", { count: "exact", head: true })
    .eq("universe_id", universeId)
    .eq("active", true);
  if (Number(currentActive) > 0) {
    return { universe_id: universeId, active_count: Number(currentActive), derived_refresh: false };
  }

  const { data: latestRows } = await supabase
    .from("price_bars")
    .select("symbol,close,volume")
    .eq("date", scanDate)
    .eq("source", "polygon");
  const rankedLatest: LiquidityRow[] = (latestRows ?? [])
    .map((r: any) => {
      const symbol = String(r?.symbol ?? "").trim().toUpperCase();
      const close = Number(r?.close);
      const volume = Number(r?.volume);
      const dollar =
        Number.isFinite(close) && close > 0 && Number.isFinite(volume) && volume > 0 ? close * volume : 0;
      return { symbol, close, volume, dollar };
    })
    .filter((r: LiquidityRow) => r.symbol && r.close > MIN_PRICE && r.volume > 0 && r.dollar > 0)
    .sort((a: LiquidityRow, b: LiquidityRow) => b.dollar - a.dollar)
    .slice(0, 6000);
  const candidateSymbols = rankedLatest.map((r: LiquidityRow) => r.symbol);
  if (!candidateSymbols.length) {
    throw new Error("No eligible symbols found in price_bars for growth_1500 derivation");
  }

  const from = new Date(`${scanDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 45);
  const fromDate = isoDate(from);
  const adv20 = new Map<string, number>();
  for (let i = 0; i < candidateSymbols.length; i += 300) {
    const chunk = candidateSymbols.slice(i, i + 300);
    const { data } = await supabase
      .from("price_bars")
      .select("symbol,date,close,volume,source")
      .in("symbol", chunk)
      .eq("source", "polygon")
      .gte("date", fromDate)
      .lte("date", scanDate)
      .order("date", { ascending: true });
    const per = new Map<string, number[]>();
    for (const row of data ?? []) {
      const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
      const close = Number((row as any)?.close);
      const volume = Number((row as any)?.volume);
      if (!symbol || !Number.isFinite(close) || close <= 0 || !Number.isFinite(volume) || volume <= 0) continue;
      if (!per.has(symbol)) per.set(symbol, []);
      per.get(symbol)!.push(close * volume);
    }
    for (const [symbol, values] of per.entries()) {
      const last20 = values.slice(-20);
      if (last20.length >= 20) adv20.set(symbol, avg(last20));
    }
  }

  let finalSymbols = rankedLatest
    .filter((r: LiquidityRow) => (adv20.get(r.symbol) ?? 0) >= MIN_AVG_DOLLAR_VOLUME_20D)
    .slice(0, TARGET_GROWTH_COUNT)
    .map((r: LiquidityRow) => r.symbol);
  if (!finalSymbols.length) {
    // Fallback for sparse history: use same-day dollar liquidity from existing bars.
    finalSymbols = rankedLatest
      .filter((r: LiquidityRow) => r.dollar >= MIN_AVG_DOLLAR_VOLUME_20D)
      .slice(0, TARGET_GROWTH_COUNT)
      .map((r: LiquidityRow) => r.symbol);
  }
  if (!finalSymbols.length) {
    throw new Error("No symbols passed derived liquidity filter for growth_1500");
  }

  await supabase.from("universe_members").update({ active: false }).eq("universe_id", universeId);
  const rows = finalSymbols.map((symbol) => ({ universe_id: universeId, symbol, active: true }));
  const { error: memberErr } = await supabase.from("universe_members").upsert(rows, {
    onConflict: "universe_id,symbol",
  });
  if (memberErr) throw new Error(memberErr.message);

  return { universe_id: universeId, active_count: finalSymbols.length, derived_refresh: true };
}

function summarizeBreadthFromCandidates(candidates: SectorMomentumCandidate[]) {
  let sample = 0;
  let above50 = 0;
  let above200 = 0;
  for (const row of candidates) {
    const checks = Array.isArray((row as any)?.reason_json?.checks) ? (row as any).reason_json.checks : [];
    const c50 = checks.find((c: any) => String(c?.key ?? "") === "close_above_sma50");
    const c200 = checks.find((c: any) => String(c?.key ?? "") === "close_above_sma200");
    if (typeof c50?.ok !== "boolean" && typeof c200?.ok !== "boolean") continue;
    sample += 1;
    if (c50?.ok === true) above50 += 1;
    if (c200?.ok === true) above200 += 1;
  }
  return {
    pct_above_sma50: sample > 0 ? (above50 / sample) * 100 : 0,
    pct_above_sma200: sample > 0 ? (above200 / sample) * 100 : 0,
    sample_size: sample,
  };
}

async function runPopulate() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Missing Supabase env vars", detail: null }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey) as any;

  const lctd = await getLCTD(supabase);
  if (!lctd.ok || !lctd.scan_date) {
    return NextResponse.json(
      { ok: false, error: lctd.error ?? "Failed to resolve scan date", detail: null },
      { status: 500 }
    );
  }
  const scanDate = lctd.scan_date;

  const universe = await ensureGrowthUniverseFromExistingBars(supabase, scanDate);

  const sector = await computeSectorMomentumCandidates({
    supabase,
    scan_date: scanDate,
    lctd_source: lctd.lctd_source,
    universe_slug: GROWTH_UNIVERSE_SLUG,
    top_group_count: 4,
    max_candidates: 12,
  });
  if (!sector.ok) {
    return NextResponse.json(
      { ok: false, error: sector.error ?? "Sector candidate computation failed", detail: null },
      { status: 500 }
    );
  }

  const rows = (sector.candidates ?? []).map((c) => ({
    date: scanDate,
    universe_slug: GROWTH_UNIVERSE_SLUG,
    strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
    symbol: c.symbol,
    signal: c.signal,
    confidence: Math.round(Number(c.confidence) || 0),
    rank_score: Math.round(Number(c.rank_score) || 0),
    rank: c.rank,
    entry: c.entry,
    stop: c.stop,
    tp1: c.tp1,
    tp2: c.tp2,
    reason_summary: c.reason_summary,
    reason_json: c.reason_json,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("daily_scans")
      .upsert(rows, { onConflict: "date,universe_slug,symbol,strategy_version" });
    if (upsertErr) {
      return NextResponse.json({ ok: false, error: upsertErr.message, detail: null }, { status: 500 });
    }
  }

  const breadth = summarizeBreadthFromCandidates(sector.candidates ?? []);
  return NextResponse.json({
    ok: true,
    scan_date_used: scanDate,
    universe_slug: GROWTH_UNIVERSE_SLUG,
    strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
    top_groups: (sector.top_groups ?? []).map((g) => ({
      key: g.key,
      name: g.name,
      state: g.state,
      rank_score: g.rank_score,
    })),
    candidates_count: sector.candidates.length,
    top_symbols: sector.candidates.slice(0, 10).map((c) => c.symbol),
    breadth,
    persisted_rows: rows.length,
    growth_universe_active_count: universe.active_count,
    growth_universe_derived_refresh: universe.derived_refresh,
  });
}

export async function POST() {
  try {
    return await runPopulate();
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

export async function GET() {
  try {
    return await runPopulate();
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
