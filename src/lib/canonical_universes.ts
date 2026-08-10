import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchActiveUsCommonSymbols, fetchPolygonMarketCaps, loadAverageDollarVolume20 } from "@/lib/universe_reference";

export const CANONICAL_UNIVERSE_VERSION = "canonical_us_common_v1";

export const CANONICAL_UNIVERSE_RULES = {
  broad: {
    slug: "liquid_2000",
    name: "Broad Liquid US",
    target_count: 2000,
    min_price: 5,
    min_adv20: 10_000_000,
    min_market_cap: 1_000_000_000,
  },
  established: {
    slug: "core_800",
    name: "Established Leaders",
    target_count: 800,
    min_price: 10,
    min_adv20: 25_000_000,
    min_market_cap: 10_000_000_000,
  },
  midcap: {
    slug: "midcap_1000",
    name: "Mid-Cap Opportunities",
    target_count: 1000,
    min_price: 5,
    min_adv20: 10_000_000,
    min_market_cap: 2_000_000_000,
    max_market_cap_exclusive: 10_000_000_000,
  },
} as const;

type LatestBar = {
  symbol: string;
  close: number;
};

type Candidate = LatestBar & {
  adv20: number;
  market_cap: number | null;
};

async function loadLatestBars(supabase: SupabaseClient, scanDate: string) {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("price_bars")
      .select("symbol,close")
      .eq("source", "polygon")
      .eq("date", scanDate)
      .order("symbol", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Latest universe bars failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }

  const bySymbol = new Map<string, LatestBar>();
  for (const row of rows) {
    const symbol = String(row.symbol ?? "").trim().toUpperCase();
    const close = Number(row.close);
    if (!symbol || !Number.isFinite(close) || close <= 0) continue;
    bySymbol.set(symbol, { symbol, close });
  }
  return bySymbol;
}

async function ensureUniverse(opts: {
  supabase: SupabaseClient;
  slug: string;
  name: string;
  description: string;
  symbols: string[];
}) {
  const { data: existing, error: lookupError } = await opts.supabase
    .from("universes")
    .select("id")
    .eq("slug", opts.slug)
    .maybeSingle();
  if (lookupError) throw new Error(`Universe lookup failed for ${opts.slug}: ${lookupError.message}`);

  let universeId = existing?.id ? String(existing.id) : "";
  if (!universeId) {
    const { data: created, error } = await opts.supabase
      .from("universes")
      .insert({ slug: opts.slug, name: opts.name, description: opts.description })
      .select("id")
      .single();
    if (error || !created?.id) throw new Error(`Universe create failed for ${opts.slug}: ${error?.message ?? "missing id"}`);
    universeId = String(created.id);
  } else {
    const { error } = await opts.supabase
      .from("universes")
      .update({ name: opts.name, description: opts.description })
      .eq("id", universeId);
    if (error) throw new Error(`Universe metadata update failed for ${opts.slug}: ${error.message}`);
  }

  const desired = new Set(opts.symbols);
  const memberRows = opts.symbols.map((symbol) => ({ universe_id: universeId, symbol, active: true }));
  for (let index = 0; index < memberRows.length; index += 500) {
    const { error } = await opts.supabase.from("universe_members").upsert(memberRows.slice(index, index + 500), {
      onConflict: "universe_id,symbol",
    });
    if (error) throw new Error(`Universe member upsert failed for ${opts.slug}: ${error.message}`);
  }

  const existingSymbols: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await opts.supabase
      .from("universe_members")
      .select("symbol")
      .eq("universe_id", universeId)
      .eq("active", true)
      .range(offset, offset + 999);
    if (error) throw new Error(`Universe member audit failed for ${opts.slug}: ${error.message}`);
    existingSymbols.push(...(data ?? []).map((row) => String(row.symbol ?? "").trim().toUpperCase()).filter(Boolean));
    if ((data?.length ?? 0) < 1000) break;
  }

  const removed = existingSymbols.filter((symbol) => !desired.has(symbol));
  for (let index = 0; index < removed.length; index += 500) {
    const { error } = await opts.supabase
      .from("universe_members")
      .update({ active: false })
      .eq("universe_id", universeId)
      .in("symbol", removed.slice(index, index + 500));
    if (error) throw new Error(`Universe member retirement failed for ${opts.slug}: ${error.message}`);
  }

  return { universe_id: universeId, active_count: opts.symbols.length, retired_count: removed.length };
}

function descriptionFor(label: string, scanDate: string, rules: Record<string, number | string>) {
  const ruleText = Object.entries(rules).map(([key, value]) => `${key}=${value}`).join(", ");
  return `${label}. ${CANONICAL_UNIVERSE_VERSION}; rebuilt from Polygon US active common stocks and cached daily bars as of ${scanDate}; ${ruleText}.`;
}

export async function rebuildCanonicalUniverses(opts: {
  supabase: SupabaseClient;
  polygonApiKey: string;
  scanDate: string;
  marketCapConcurrency?: number;
}) {
  const startedAt = Date.now();
  const latestBars = await loadLatestBars(opts.supabase, opts.scanDate);
  if (!latestBars.size) throw new Error(`No Polygon price_bars found for ${opts.scanDate}`);

  const activeUsCommon = await fetchActiveUsCommonSymbols(opts.polygonApiKey);
  const eligibleLatest = Array.from(latestBars.values()).filter(
    (row) => activeUsCommon.has(row.symbol) && row.close >= CANONICAL_UNIVERSE_RULES.broad.min_price
  );
  const adv20 = await loadAverageDollarVolume20({
    supabase: opts.supabase,
    symbols: eligibleLatest.map((row) => row.symbol),
    scanDate: opts.scanDate,
  });

  const broadBase = eligibleLatest
    .map((row) => ({ ...row, adv20: adv20.get(row.symbol) ?? 0 }))
    .filter((row) => row.adv20 >= CANONICAL_UNIVERSE_RULES.broad.min_adv20)
    .sort((a, b) => b.adv20 - a.adv20)
    .slice(0, CANONICAL_UNIVERSE_RULES.broad.target_count);
  if (!broadBase.length) throw new Error("No symbols passed canonical broad-liquidity rules");

  const marketCaps = await fetchPolygonMarketCaps(
    opts.polygonApiKey,
    broadBase.map((row) => row.symbol),
    opts.marketCapConcurrency ?? 24
  );
  const candidatesWithCaps: Candidate[] = broadBase.map((row) => ({
    ...row,
    market_cap: marketCaps.get(row.symbol) ?? null,
  }));
  const marketCapCoverage = candidatesWithCaps.filter((row) => row.market_cap !== null).length / candidatesWithCaps.length;
  if (marketCapCoverage < 0.5) {
    throw new Error(`Polygon market-cap coverage too low (${(marketCapCoverage * 100).toFixed(1)}%); no memberships changed`);
  }

  const candidates = candidatesWithCaps.filter(
    (row) => (row.market_cap ?? 0) >= CANONICAL_UNIVERSE_RULES.broad.min_market_cap
  );
  const established = candidates
    .filter(
      (row) =>
        row.close >= CANONICAL_UNIVERSE_RULES.established.min_price &&
        row.adv20 >= CANONICAL_UNIVERSE_RULES.established.min_adv20 &&
        (row.market_cap ?? 0) >= CANONICAL_UNIVERSE_RULES.established.min_market_cap
    )
    .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0) || b.adv20 - a.adv20)
    .slice(0, CANONICAL_UNIVERSE_RULES.established.target_count);
  const midcap = candidates
    .filter(
      (row) =>
        row.close >= CANONICAL_UNIVERSE_RULES.midcap.min_price &&
        row.adv20 >= CANONICAL_UNIVERSE_RULES.midcap.min_adv20 &&
        (row.market_cap ?? 0) >= CANONICAL_UNIVERSE_RULES.midcap.min_market_cap &&
        (row.market_cap ?? 0) < CANONICAL_UNIVERSE_RULES.midcap.max_market_cap_exclusive
    )
    .sort((a, b) => b.adv20 - a.adv20)
    .slice(0, CANONICAL_UNIVERSE_RULES.midcap.target_count);

  if (!established.length || !midcap.length) {
    throw new Error(`Canonical cohort generation failed (established=${established.length}, midcap=${midcap.length})`);
  }

  const broadResult = await ensureUniverse({
    supabase: opts.supabase,
    slug: CANONICAL_UNIVERSE_RULES.broad.slug,
    name: CANONICAL_UNIVERSE_RULES.broad.name,
    description: descriptionFor("Broad liquid US common-stock opportunity pool", opts.scanDate, {
      min_price: CANONICAL_UNIVERSE_RULES.broad.min_price,
      min_adv20: CANONICAL_UNIVERSE_RULES.broad.min_adv20,
      min_market_cap: CANONICAL_UNIVERSE_RULES.broad.min_market_cap,
      target_count: CANONICAL_UNIVERSE_RULES.broad.target_count,
    }),
    symbols: candidates.map((row) => row.symbol),
  });
  const establishedResult = await ensureUniverse({
    supabase: opts.supabase,
    slug: CANONICAL_UNIVERSE_RULES.established.slug,
    name: CANONICAL_UNIVERSE_RULES.established.name,
    description: descriptionFor("Established liquid US common-stock leaders", opts.scanDate, {
      min_price: CANONICAL_UNIVERSE_RULES.established.min_price,
      min_adv20: CANONICAL_UNIVERSE_RULES.established.min_adv20,
      min_market_cap: CANONICAL_UNIVERSE_RULES.established.min_market_cap,
    }),
    symbols: established.map((row) => row.symbol),
  });
  const midcapResult = await ensureUniverse({
    supabase: opts.supabase,
    slug: CANONICAL_UNIVERSE_RULES.midcap.slug,
    name: CANONICAL_UNIVERSE_RULES.midcap.name,
    description: descriptionFor("Liquid US common-stock mid-cap opportunities", opts.scanDate, {
      min_price: CANONICAL_UNIVERSE_RULES.midcap.min_price,
      min_adv20: CANONICAL_UNIVERSE_RULES.midcap.min_adv20,
      min_market_cap: CANONICAL_UNIVERSE_RULES.midcap.min_market_cap,
      max_market_cap_exclusive: CANONICAL_UNIVERSE_RULES.midcap.max_market_cap_exclusive,
    }),
    symbols: midcap.map((row) => row.symbol),
  });

  const { data: legacyGrowth } = await opts.supabase
    .from("universes")
    .select("id")
    .eq("slug", "growth_1500")
    .maybeSingle();
  if (legacyGrowth?.id) {
    await opts.supabase
      .from("universes")
      .update({
        name: "Legacy Growth 1500 (retired)",
        description: `Retired from active strategy routing by ${CANONICAL_UNIVERSE_VERSION}; historical scan rows retained.`,
      })
      .eq("id", legacyGrowth.id);
  }

  const summary = {
    ok: true,
    version: CANONICAL_UNIVERSE_VERSION,
    scan_date: opts.scanDate,
    source: "polygon_reference_plus_cached_polygon_daily_bars",
    active_us_common_count: activeUsCommon.size,
    latest_bar_count: latestBars.size,
    adv20_eligible_count: broadBase.length,
    broad_eligible_count: candidates.length,
    market_cap_coverage_pct: Math.round(marketCapCoverage * 1000) / 10,
    universes: {
      established_leaders: { ...establishedResult, slug: CANONICAL_UNIVERSE_RULES.established.slug },
      broad_liquid_us: { ...broadResult, slug: CANONICAL_UNIVERSE_RULES.broad.slug },
      midcap_opportunities: { ...midcapResult, slug: CANONICAL_UNIVERSE_RULES.midcap.slug },
    },
    sample: {
      established: established.slice(0, 20).map((row) => row.symbol),
      broad: candidates.slice(0, 20).map((row) => row.symbol),
      midcap: midcap.slice(0, 20).map((row) => row.symbol),
    },
    duration_ms: Date.now() - startedAt,
  };

  await opts.supabase.from("system_status").upsert(
    { key: "canonical_universe_rebuild", value: summary, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  return summary;
}
