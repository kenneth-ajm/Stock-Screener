import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLCTD } from "@/lib/scan_date";
import {
  computeSectorMomentumCandidates,
  SECTOR_MOMENTUM_STRATEGY_VERSION,
  type SectorMomentumCandidate,
} from "@/lib/sector_momentum";
import { LEGACY_MOMENTUM_UNIVERSE_SLUG } from "@/lib/strategy_universe";
import { OBS_KEYS, writeObservabilityStatus } from "@/lib/observability";
import { scoreSignalQuality } from "@/lib/signal_quality";
import { buildTradeRiskLayer } from "@/lib/trade_risk_layer";

async function ensureExistingUniverseMembers(supabase: any, universeSlug: string) {
  const { data: universe } = await supabase
    .from("universes")
    .select("id,slug")
    .eq("slug", universeSlug)
    .maybeSingle();
  if (!universe?.id) {
    throw new Error(`Universe not found: ${universeSlug}`);
  }
  const { count } = await supabase
    .from("universe_members")
    .select("symbol", { count: "exact", head: true })
    .eq("universe_id", universe.id)
    .eq("active", true);
  const activeCount = Number(count ?? 0);
  if (activeCount <= 0) {
    throw new Error(`Universe has no active members: ${universeSlug}`);
  }
  return { universe_id: universe.id, active_count: activeCount, derived_refresh: false };
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

export async function runPopulate(opts?: { universe_slug?: string }) {
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
  const universeSlug =
    String(opts?.universe_slug ?? LEGACY_MOMENTUM_UNIVERSE_SLUG).trim() || LEGACY_MOMENTUM_UNIVERSE_SLUG;

  const universe = await ensureExistingUniverseMembers(supabase, universeSlug);

  const sector = await computeSectorMomentumCandidates({
    supabase,
    scan_date: scanDate,
    lctd_source: lctd.lctd_source,
    universe_slug: universeSlug,
    top_group_count: 4,
    max_candidates: 12,
  });
  if (!sector.ok) {
    return NextResponse.json(
      { ok: false, error: sector.error ?? "Sector candidate computation failed", detail: null },
      { status: 500 }
    );
  }

  const rows = (sector.candidates ?? []).map((c) => {
    const quality = scoreSignalQuality({
      strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
      signal: c.signal,
      confidence: c.confidence,
      rank_score: c.rank_score,
      regime_state: null,
      reason_json: c.reason_json,
      entry: c.entry,
      stop: c.stop,
    });
    const tradeRisk = buildTradeRiskLayer({
      strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
      signal: c.signal,
      quality_score: quality.quality_score,
      risk_grade: quality.risk_grade,
      confidence: c.confidence,
      entry: c.entry,
      stop: c.stop,
      tp1: c.tp1,
      tp2: c.tp2,
      max_holding_days: 7,
    });
    return {
      date: scanDate,
      universe_slug: universeSlug,
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
      reason_json: {
        ...(c.reason_json ?? {}),
        signal_quality: {
          quality_score: quality.quality_score,
          risk_grade: quality.risk_grade,
          quality_signal: quality.quality_signal,
          components: quality.components,
          summary: quality.quality_summary,
        },
        trade_risk_layer: tradeRisk,
      },
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("daily_scans")
      .upsert(rows, { onConflict: "date,universe_slug,symbol,strategy_version" });
    if (upsertErr) {
      return NextResponse.json({ ok: false, error: upsertErr.message, detail: null }, { status: 500 });
    }
  }
  let pruned_rows = 0;
  {
    const keep = new Set(rows.map((r) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean));
    const { data: existing } = await supabase
      .from("daily_scans")
      .select("id,symbol")
      .eq("date", scanDate)
      .eq("universe_slug", universeSlug)
      .eq("strategy_version", SECTOR_MOMENTUM_STRATEGY_VERSION);
    const removeIds = (existing ?? [])
      .filter((r: any) => !keep.has(String(r?.symbol ?? "").trim().toUpperCase()))
      .map((r: any) => String(r?.id ?? ""))
      .filter(Boolean);
    for (let i = 0; i < removeIds.length; i += 200) {
      const chunk = removeIds.slice(i, i + 200);
      const { error: delErr } = await supabase.from("daily_scans").delete().in("id", chunk);
      if (delErr) {
        return NextResponse.json({ ok: false, error: delErr.message, detail: null }, { status: 500 });
      }
    }
    pruned_rows = removeIds.length;
  }

  const breadth = summarizeBreadthFromCandidates(sector.candidates ?? []);
  console.info("[sector_momentum][populate]", {
    scan_date_used: scanDate,
    strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
    universe_slug: universeSlug,
    top_groups: (sector.top_groups ?? []).length,
    candidates_count: sector.candidates.length,
    persisted_rows: rows.length,
    pruned_rows,
    growth_universe_active_count: universe.active_count,
    growth_universe_derived_refresh: universe.derived_refresh,
  });
  const payload = {
    ok: true,
    scan_date_used: scanDate,
    universe_slug: universeSlug,
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
    pruned_rows,
    growth_universe_active_count: universe.active_count,
    growth_universe_derived_refresh: universe.derived_refresh,
  };
  await writeObservabilityStatus({
    supabase,
    key: OBS_KEYS.sector,
    value: {
      ok: true,
      scan_date_used: scanDate,
      strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
      universe_slug: universeSlug,
      candidates_count: payload.candidates_count,
      persisted_rows: payload.persisted_rows,
      pruned_rows: payload.pruned_rows,
      breadth: payload.breadth,
      top_groups_count: payload.top_groups.length,
      top_symbols: payload.top_symbols,
    },
  });
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { universe_slug?: string };
    return await runPopulate({ universe_slug: body?.universe_slug });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    await writeObservabilityStatus({
      key: OBS_KEYS.sector,
      value: { ok: false, error },
    }).catch(() => null);
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

export async function GET() {
  try {
    return await runPopulate();
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    await writeObservabilityStatus({
      key: OBS_KEYS.sector,
      value: { ok: false, error },
    }).catch(() => null);
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
