import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import { getLCTD } from "@/lib/scan_status";
import { getActivePortfolioCapacity } from "@/lib/portfolio_capacity";
import { computePortfolioAwareAction } from "@/lib/execution_action";
import { computeMarketBreadth } from "@/lib/market_breadth";
import { scoreSignalQuality } from "@/lib/signal_quality";
import { buildTradeRiskLayer } from "@/lib/trade_risk_layer";
import {
  SECTOR_MOMENTUM_STRATEGY_VERSION,
} from "@/lib/sector_momentum";
import { allowedUniversesForStrategy, defaultUniverseForStrategy } from "@/lib/strategy_universe";

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY = "v1";
const BUY_CAP = 5;
const WATCH_CAP = 10;
const MAX_ROWS = 200;
const ENTRY_MISMATCH_THRESHOLD_PCT = 0.6;

function normalizeStrategyVersion(input: string | null | undefined) {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return DEFAULT_STRATEGY;
  if (raw === "trend" || raw === "v1_trend_hold") return "v1_trend_hold";
  if (raw === "sector" || raw === "v1_sector_momentum") return "v1_sector_momentum";
  if (raw === "momentum" || raw === "swing" || raw === "core" || raw === "v2_core_momentum" || raw === "v1")
    return "v1";
  return raw;
}

type ScanRow = {
  symbol: string;
  universe_slug?: string | null;
  source_scan_date?: string | null;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  rank_score?: number | null;
  rank?: number | null;
  quality_score?: number | null;
  risk_grade?: "A" | "B" | "C" | "D" | null;
  quality_signal?: "BUY" | "WATCH" | "AVOID" | null;
  quality_summary?: string | null;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  reason_summary?: string | null;
  reason_json?: Record<string, unknown> | null;
  trade_risk_layer?: Record<string, unknown> | null;
  industry_group?: string | null;
  theme?: string | null;
};

async function latestUniverseStats(supabase: any, strategyVersion: string, universeSlug: string) {
  const { data: latest } = await supabase
    .from("daily_scans")
    .select("date")
    .eq("strategy_version", strategyVersion)
    .eq("universe_slug", universeSlug)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestDate = latest?.date ? String(latest.date) : null;
  if (!latestDate) {
    return {
      universe_slug: universeSlug,
      latest_date: null,
      rows: 0,
      buy: 0,
      watch: 0,
      avoid: 0,
      has_scans: false,
    };
  }
  const { data: rows } = await supabase
    .from("daily_scans")
    .select("signal")
    .eq("strategy_version", strategyVersion)
    .eq("universe_slug", universeSlug)
    .eq("date", latestDate);
  const arr = Array.isArray(rows) ? rows : [];
  let buy = 0;
  let watch = 0;
  let avoid = 0;
  for (const row of arr) {
    const sig = String((row as any)?.signal ?? "").toUpperCase();
    if (sig === "BUY") buy += 1;
    else if (sig === "WATCH") watch += 1;
    else if (sig === "AVOID") avoid += 1;
  }
  return {
    universe_slug: universeSlug,
    latest_date: latestDate,
    rows: arr.length,
    buy,
    watch,
    avoid,
    has_scans: arr.length > 0,
  };
}

function rankRows(rows: ScanRow[]) {
  return [...rows].sort((a, b) => {
    const ar = typeof a.rank_score === "number" ? a.rank_score : Number(a.confidence ?? 0);
    const br = typeof b.rank_score === "number" ? b.rank_score : Number(b.confidence ?? 0);
    if (br !== ar) return br - ar;
    return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
  });
}

function applyDisplayCaps(rows: ScanRow[]) {
  const buyRanked = rankRows(rows.filter((r) => r.signal === "BUY")).slice(0, BUY_CAP);
  const watchRanked = rankRows(rows.filter((r) => r.signal === "WATCH")).slice(0, WATCH_CAP);
  const avoidRanked = rankRows(rows.filter((r) => r.signal !== "BUY" && r.signal !== "WATCH"));
  return rankRows([...buyRanked, ...watchRanked, ...avoidRanked]).slice(0, MAX_ROWS);
}

function getCheckOk(reasonJson: any, key: string): boolean | null {
  const checks = Array.isArray(reasonJson?.checks) ? reasonJson.checks : [];
  for (const check of checks) {
    const checkKey = String(check?.key ?? check?.id ?? "").trim();
    if (checkKey !== key) continue;
    if (typeof check?.ok === "boolean") return check.ok;
  }
  return null;
}

function classifyBreadth(regimeState: string | null, pct50: number, pct200: number) {
  const favorable = String(regimeState ?? "").toUpperCase() === "FAVORABLE";
  if (favorable && pct50 >= 60 && pct200 >= 50) return { breadthState: "STRONG" as const, breadthLabel: "Breadth strong" };
  if (!favorable || pct50 < 40 || pct200 < 35) return { breadthState: "WEAK" as const, breadthLabel: "Breadth weak" };
  return { breadthState: "MIXED" as const, breadthLabel: "Breadth mixed" };
}

function computeSectorBreadth(rows: ScanRow[], regimeState: string | null) {
  let sample = 0;
  let above50 = 0;
  let above200 = 0;
  for (const row of rows) {
    const c50 = getCheckOk(row.reason_json, "close_above_sma50");
    const c200 = getCheckOk(row.reason_json, "close_above_sma200");
    if (c50 === null && c200 === null) continue;
    sample += 1;
    if (c50 === true) above50 += 1;
    if (c200 === true) above200 += 1;
  }
  const pct50 = sample > 0 ? (above50 / sample) * 100 : 0;
  const pct200 = sample > 0 ? (above200 / sample) * 100 : 0;
  const cls = classifyBreadth(regimeState, pct50, pct200);
  return {
    pctAboveSma50: pct50,
    pctAboveSma200: pct200,
    breadthState: cls.breadthState,
    breadthLabel: cls.breadthLabel,
    sampleSize: sample,
  };
}

const loadScreenerDataCached = unstable_cache(
  async (
    userId: string,
    universeSlug: string,
    strategyVersion: string,
    requestedDate: string | null,
    cacheBust: string | null
  ) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;

    const lctd = await getLCTD(supabase as any);
    const requestedUniverse = String(universeSlug ?? "").trim();
    const allowedUniverses = allowedUniversesForStrategy(strategyVersion);
    let mappedUniverse = requestedUniverse || defaultUniverseForStrategy(strategyVersion) || DEFAULT_UNIVERSE;
    const isAutoUniverse = !requestedUniverse;
    const dateUsed = requestedDate && requestedDate.trim() ? requestedDate.trim() : lctd.lctd;
    if (!requestedUniverse) {
      const { data: latestUniverseRow } = await (supabase as any)
        .from("daily_scans")
        .select("universe_slug,date")
        .eq("strategy_version", strategyVersion)
        .in("universe_slug", allowedUniverses)
        .not("universe_slug", "is", null)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const latestUniverse = String(latestUniverseRow?.universe_slug ?? "").trim();
      if (latestUniverse) {
        mappedUniverse = latestUniverse;
      }
    }
    const { data: regimeExactRows } = await supabase
      .from("market_regime")
      .select("date,state")
      .eq("symbol", "SPY")
      .eq("date", lctd.lctd)
      .limit(1);
    const regimeExact = regimeExactRows?.[0] ?? null;
    const { data: regimeRows } = await supabase
      .from("market_regime")
      .select("date,state")
      .eq("symbol", "SPY")
      .order("date", { ascending: false })
      .limit(1);
    const regimeRow = regimeRows?.[0] ?? null;
    const regimeDate = regimeExact?.date
      ? String(regimeExact.date)
      : regimeRow?.date
        ? String(regimeRow.date)
        : null;
    const regimeState = regimeExact?.state ?? regimeRow?.state ?? null;
    const regimeStale = !lctd.lctd || !regimeDate || regimeDate < lctd.lctd;
    const isSectorMomentum = strategyVersion === SECTOR_MOMENTUM_STRATEGY_VERSION;
    const fetchRowsFor = async (universe: string, d: string | null) => {
      if (!d) return [] as any[];
      const { data } = await (supabase as any)
        .from("daily_scans")
        .select(
          "symbol,signal,confidence,entry,stop,tp1,tp2,rank,rank_score,reason_summary,reason_json,universe_slug,date"
        )
        .eq("universe_slug", universe)
        .eq("strategy_version", strategyVersion)
        .eq("date", d)
        .order("rank", { ascending: true, nullsFirst: false })
        .order("confidence", { ascending: false })
        .order("symbol", { ascending: true })
        .limit(200);
      return (data ?? []) as any[];
    };

    let resolvedDateUsed = dateUsed;
    let dataSource = "daily_scans_cache";
    const fallbackDecisions: string[] = [];
    let rawRows: ScanRow[] = [];
    const autoUniverseDates: Array<{ universe_slug: string; date_used: string | null; rows: number }> = [];

    if (isAutoUniverse) {
      dataSource = "daily_scans_cache_auto_union";
      const unionRows: ScanRow[] = [];
      for (const universe of allowedUniverses) {
        let universeDate = resolvedDateUsed;
        let rows = await fetchRowsFor(universe, universeDate);
        if (rows.length === 0) {
          const { data: latestDateSameUniverse } = await (supabase as any)
            .from("daily_scans")
            .select("date")
            .eq("strategy_version", strategyVersion)
            .eq("universe_slug", universe)
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle();
          const fallbackDate = latestDateSameUniverse?.date ? String(latestDateSameUniverse.date) : null;
          if (fallbackDate && fallbackDate !== universeDate) {
            universeDate = fallbackDate;
            rows = await fetchRowsFor(universe, universeDate);
          }
        }
        autoUniverseDates.push({
          universe_slug: universe,
          date_used: universeDate ?? null,
          rows: rows.length,
        });
        unionRows.push(...rows);
      }
      rawRows = unionRows;
      const populated = autoUniverseDates
        .filter((u) => u.rows > 0)
        .sort((a, b) => String(b.date_used ?? "").localeCompare(String(a.date_used ?? "")));
      if (populated[0]?.universe_slug) {
        mappedUniverse = populated[0].universe_slug;
        resolvedDateUsed = populated[0].date_used ?? resolvedDateUsed;
      }
    } else {
      rawRows = await fetchRowsFor(mappedUniverse, resolvedDateUsed);
      if (rawRows.length === 0) {
        const { data: latestDateSameUniverse } = await (supabase as any)
          .from("daily_scans")
          .select("date")
          .eq("strategy_version", strategyVersion)
          .eq("universe_slug", mappedUniverse)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        const fallbackDate = latestDateSameUniverse?.date ? String(latestDateSameUniverse.date) : null;
        if (fallbackDate && fallbackDate !== resolvedDateUsed) {
          resolvedDateUsed = fallbackDate;
          rawRows = await fetchRowsFor(mappedUniverse, resolvedDateUsed);
          dataSource = "daily_scans_cache_fallback_latest_date";
          fallbackDecisions.push(`date->${resolvedDateUsed} (latest for strategy+universe)`);
        }
      }
    }

    let sectorGroups: Array<{ key: string; name: string; theme: string; rank_score: number; state: string }> = [];
    if (isSectorMomentum) {
      const groupMap = new Map<string, { key: string; name: string; theme: string; rank_score: number; state: string }>();
      for (const row of rawRows) {
        const key = String((row as any)?.reason_json?.group?.key ?? "").trim();
        if (!key || groupMap.has(key)) continue;
        groupMap.set(key, {
          key,
          name: String((row as any)?.reason_json?.group?.name ?? key),
          theme: String((row as any)?.reason_json?.group?.theme ?? ""),
          rank_score: Number((row as any)?.reason_json?.group?.group_rank_score ?? 0) || 0,
          state: String((row as any)?.reason_json?.group?.state ?? ""),
        });
      }
      sectorGroups = [...groupMap.values()].sort((a, b) => b.rank_score - a.rank_score).slice(0, 4);
      rawRows = rawRows.map((r: any) => ({
        ...r,
        industry_group: String(r?.reason_json?.group?.name ?? ""),
        theme: String(r?.reason_json?.group?.theme ?? ""),
      }));
    }

    const breadth = isSectorMomentum
      ? computeSectorBreadth(Array.isArray(rawRows) ? rawRows : [], regimeState)
      : await computeMarketBreadth({
          supabase: supabase as any,
          date: resolvedDateUsed ?? null,
          universe_slug: mappedUniverse,
          strategy_version: strategyVersion,
          regime_state: regimeState,
        });

    const capacity = await getActivePortfolioCapacity({
      supabase: supabase as any,
      userId,
    });

    if (isSectorMomentum) {
      console.info("[sector_momentum][screener-data]", {
        requested_date: dateUsed,
        date_used: resolvedDateUsed,
        universe_slug: mappedUniverse,
        strategy_version: strategyVersion,
        rows_returned: rawRows.length,
        source: dataSource,
      });
    }
    let entryValidatedRows = rawRows;
    if (resolvedDateUsed && rawRows.length > 0 && !isSectorMomentum) {
      const symbols = Array.from(new Set(rawRows.map((r) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean)));
      const { data: barsOnDate } = await (supabase as any)
        .from("price_bars")
        .select("symbol,close,date")
        .eq("date", resolvedDateUsed)
        .in("symbol", symbols);
      const closeBySymbol = new Map<string, number>();
      for (const row of barsOnDate ?? []) {
        const sym = String(row?.symbol ?? "").trim().toUpperCase();
        const close = Number(row?.close);
        if (!sym || !Number.isFinite(close) || close <= 0) continue;
        if (!closeBySymbol.has(sym)) closeBySymbol.set(sym, close);
      }
      entryValidatedRows = rawRows.filter((row) => {
        const sym = String(row.symbol ?? "").trim().toUpperCase();
        const scanClose = closeBySymbol.get(sym);
        if (scanClose == null) return true;
        const entry = Number(row.entry);
        if (!Number.isFinite(entry) || entry <= 0) return false;
        const mismatch = Math.abs((entry - scanClose) / scanClose) > ENTRY_MISMATCH_THRESHOLD_PCT;
        return !mismatch;
      });
    }

    const cappedRows = applyDisplayCaps(entryValidatedRows);
    const withActions = cappedRows.map((row) => {
      const persistedSignalQuality = (row?.reason_json as any)?.signal_quality as
        | { quality_score?: unknown; risk_grade?: unknown; quality_signal?: unknown; summary?: unknown }
        | undefined;
      const quality =
        typeof persistedSignalQuality?.quality_score === "number" &&
        Number.isFinite(persistedSignalQuality?.quality_score)
          ? {
              quality_score: Number(persistedSignalQuality.quality_score),
              risk_grade: (persistedSignalQuality?.risk_grade ?? "C") as "A" | "B" | "C" | "D",
            }
          : scoreSignalQuality({
              strategy_version: strategyVersion,
              signal: row.signal,
              confidence: Number(row.confidence ?? 0),
              rank_score: typeof row.rank_score === "number" ? row.rank_score : null,
              regime_state: regimeState,
              reason_json: row.reason_json ?? null,
              entry: Number(row.entry ?? 0),
              stop: Number(row.stop ?? 0),
            });
      const tradeRisk = buildTradeRiskLayer({
        strategy_version: strategyVersion,
        signal: row.signal,
        quality_score: Number(quality.quality_score ?? 50),
        risk_grade: (quality.risk_grade ?? "C") as "A" | "B" | "C" | "D",
        confidence: Number(row.confidence ?? 0),
        entry: Number(row.entry ?? 0),
        stop: Number(row.stop ?? 0),
        tp1: Number(row.tp1 ?? 0),
        tp2: Number(row.tp2 ?? 0),
        max_holding_days: strategyVersion === "v1_trend_hold" ? 45 : 7,
      });
      const action = computePortfolioAwareAction(
        {
          signal: row.signal,
          entry: Number(row.entry),
          stop: Number(row.stop),
          confidence: Number(row.confidence ?? 0),
          rank_score: typeof row.rank_score === "number" ? row.rank_score : null,
        },
        capacity
      );
      const persistedTradeRisk =
        row.reason_json && typeof row.reason_json === "object"
          ? ((row.reason_json as Record<string, unknown>).trade_risk_layer as Record<string, unknown> | undefined)
          : undefined;
      return {
        symbol: row.symbol,
        universe_slug: String((row as any).universe_slug ?? mappedUniverse ?? "").trim() || null,
        source_scan_date: String((row as any).date ?? resolvedDateUsed ?? "").trim() || null,
        signal: row.signal,
        confidence: Number(row.confidence ?? 0),
        entry: Number(row.entry ?? 0),
        stop: Number(row.stop ?? 0),
        tp1: Number(row.tp1 ?? 0),
        tp2: Number(row.tp2 ?? 0),
        rank: row.rank ?? null,
        rank_score: row.rank_score ?? null,
        quality_score: persistedSignalQuality?.quality_score ?? null,
        risk_grade: (persistedSignalQuality?.risk_grade as any) ?? null,
        quality_signal: (persistedSignalQuality?.quality_signal as any) ?? null,
        quality_summary: (persistedSignalQuality?.summary as any) ?? null,
        trade_risk_layer: persistedTradeRisk ?? tradeRisk,
        reason_summary: row.reason_summary ?? null,
        reason_json: row.reason_json ?? null,
        industry_group: row.industry_group ?? null,
        theme: row.theme ?? null,
        atr14: null,
        event_risk: false,
        news_risk: false,
        action: action.action,
        action_reason: action.action_reason,
        sizing: action.sizing,
      };
    });

    const buyNowSorted = withActions
      .filter((r) => r.action === "BUY_NOW")
      .sort((a, b) => {
        const ar = typeof a.rank_score === "number" ? a.rank_score : a.confidence;
        const br = typeof b.rank_score === "number" ? b.rank_score : b.confidence;
        if (br !== ar) return br - ar;
        return a.symbol.localeCompare(b.symbol);
      });
    const keepBuyNow = new Set(buyNowSorted.slice(0, 3).map((r) => r.symbol));
    const rowsFinal = withActions.map((row) =>
      row.action === "BUY_NOW" && !keepBuyNow.has(row.symbol)
        ? { ...row, action: "WAIT" as const, action_reason: "Prioritize top 3 actionable today" }
        : row
    );
    const rawSignalCounts = {
      buy: rawRows.filter((r) => r.signal === "BUY").length,
      watch: rawRows.filter((r) => r.signal === "WATCH").length,
      avoid: rawRows.filter((r) => r.signal === "AVOID").length,
    };
    const validatedSignalCounts = {
      buy: entryValidatedRows.filter((r) => r.signal === "BUY").length,
      watch: entryValidatedRows.filter((r) => r.signal === "WATCH").length,
      avoid: entryValidatedRows.filter((r) => r.signal === "AVOID").length,
    };
    const displaySignalCounts = {
      buy: rowsFinal.filter((r) => r.signal === "BUY").length,
      watch: rowsFinal.filter((r) => r.signal === "WATCH").length,
      avoid: rowsFinal.filter((r) => r.signal === "AVOID").length,
    };
    const [coreStats, midcapStats, liquidStats, growthStats] = await Promise.all([
      latestUniverseStats(supabase as any, strategyVersion, "core_800"),
      latestUniverseStats(supabase as any, strategyVersion, "midcap_1000"),
      latestUniverseStats(supabase as any, strategyVersion, "liquid_2000"),
      latestUniverseStats(supabase as any, strategyVersion, "growth_1500"),
    ]);

    return {
      ok: true,
      meta: {
        strategy_version: strategyVersion,
        universe_slug: mappedUniverse,
        requested_universe_slug: requestedUniverse || null,
        requested_date: requestedDate ?? null,
        date_used: resolvedDateUsed ?? null,
        lctd: lctd.lctd,
        lctd_source: lctd.source,
        data_source: dataSource,
        fallback_decisions: fallbackDecisions,
        rows_raw_count: rawRows.length,
        rows_after_validation_count: entryValidatedRows.length,
        rows_display_count: rowsFinal.length,
        rows_signal_counts_raw: rawSignalCounts,
        rows_signal_counts_validated: validatedSignalCounts,
        rows_signal_counts_display: displaySignalCounts,
        rows_count_scope: "loaded_rows_limit",
        rows_query_limit: MAX_ROWS,
        selected_universe_has_rows: rawRows.length > 0,
        selected_universe_mode: isAutoUniverse ? "auto_union" : "explicit",
        allowed_universes: allowedUniverses,
        auto_universe_dates: autoUniverseDates,
        universe_availability: {
          core_800: coreStats,
          midcap_1000: midcapStats,
          liquid_2000: liquidStats,
          growth_1500: growthStats,
        },
        response_shape: {
          raw_rows_is_array: Array.isArray(rawRows),
          validated_rows_is_array: Array.isArray(entryValidatedRows),
          final_rows_is_array: Array.isArray(rowsFinal),
        },
        cache_bust: cacheBust ?? null,
        read_context_key: `${strategyVersion}:${mappedUniverse}:${resolvedDateUsed ?? "none"}`,
        read_context_is_fallback: fallbackDecisions.length > 0,
        regime_state: regimeState,
        regime_date: regimeDate,
        regime_stale: regimeStale,
        sector_momentum: isSectorMomentum
          ? {
                universe_slug: mappedUniverse,
                strategy_universe_slug: mappedUniverse,
                top_group_count: 4,
                source: dataSource,
                date_used: resolvedDateUsed,
                rows_returned: rawRows.length,
                groups: sectorGroups,
              }
          : null,
        breadth_state: breadth.breadthState,
        breadth_label: breadth.breadthLabel,
        pct_above_sma50: breadth.pctAboveSma50,
        pct_above_sma200: breadth.pctAboveSma200,
        breadth_sample_size: breadth.sampleSize,
      },
      capacity,
      universe_slug: mappedUniverse,
      rows: rowsFinal,
    };
  },
  ["screener-data-v1"],
  { revalidate: 60 }
);

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
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
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const strategyVersion = normalizeStrategyVersion(url.searchParams.get("strategy_version"));
    const universeSlug = String(url.searchParams.get("universe_slug") ?? "").trim();
    const date = String(url.searchParams.get("date") ?? "").trim() || null;
    const cacheBust = String(url.searchParams.get("_bust") ?? "").trim() || null;

    const data = await loadScreenerDataCached(user.id, universeSlug, strategyVersion, date, cacheBust);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=60",
      },
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
