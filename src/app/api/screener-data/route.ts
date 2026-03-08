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
import { defaultUniverseForStrategy } from "@/lib/strategy_universe";

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY = "v1";
const BUY_CAP = 5;
const WATCH_CAP = 10;
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
  return rankRows([...buyRanked, ...watchRanked]);
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
  async (userId: string, universeSlug: string, strategyVersion: string, requestedDate: string | null) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;

    const lctd = await getLCTD(supabase as any);
    const mappedUniverse = defaultUniverseForStrategy(strategyVersion) || universeSlug;
    const dateUsed = requestedDate && requestedDate.trim() ? requestedDate.trim() : lctd.lctd;
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
    let sectorDateUsed = dateUsed;
    let sectorRows: any[] = [];
    let sectorGroups: Array<{ key: string; name: string; theme: string; rank_score: number; state: string }> = [];
    let sectorSource = "daily_scans_cache";
    if (isSectorMomentum) {
      const fetchRowsForDate = async (d: string | null) => {
        if (!d) return [] as any[];
        const { data } = await (supabase as any)
          .from("daily_scans")
          .select("symbol,signal,confidence,entry,stop,tp1,tp2,rank,rank_score,reason_summary,reason_json")
          .eq("universe_slug", mappedUniverse)
          .eq("strategy_version", strategyVersion)
          .eq("date", d)
          .order("rank_score", { ascending: false, nullsFirst: false })
          .order("confidence", { ascending: false })
          .order("symbol", { ascending: true })
          .limit(200);
        return (data ?? []) as any[];
      };
      sectorRows = await fetchRowsForDate(sectorDateUsed);
      if (sectorRows.length === 0) {
        const { data: latestSectorDateRow } = await (supabase as any)
          .from("daily_scans")
          .select("date")
          .eq("universe_slug", mappedUniverse)
          .eq("strategy_version", strategyVersion)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        const fallbackDate = latestSectorDateRow?.date ? String(latestSectorDateRow.date) : null;
        if (fallbackDate && fallbackDate !== sectorDateUsed) {
          sectorDateUsed = fallbackDate;
          sectorRows = await fetchRowsForDate(sectorDateUsed);
          sectorSource = "daily_scans_cache_fallback_latest_date";
        }
      }
      const groupMap = new Map<string, { key: string; name: string; theme: string; rank_score: number; state: string }>();
      for (const row of sectorRows) {
        const key = String((row as any)?.reason_json?.group?.key ?? "").trim();
        if (!key) continue;
        if (groupMap.has(key)) continue;
        groupMap.set(key, {
          key,
          name: String((row as any)?.reason_json?.group?.name ?? key),
          theme: String((row as any)?.reason_json?.group?.theme ?? ""),
          rank_score: Number((row as any)?.reason_json?.group?.group_rank_score ?? 0) || 0,
          state: String((row as any)?.reason_json?.group?.state ?? ""),
        });
      }
      sectorGroups = [...groupMap.values()].sort((a, b) => b.rank_score - a.rank_score).slice(0, 4);
    }

    let nonSectorDateUsed = dateUsed;
    let nonSectorSource = "daily_scans_cache";
    const { data: rows } = isSectorMomentum
      ? ({
          data: (sectorRows ?? []).map((r: any) => ({
            ...r,
            industry_group: String(r?.reason_json?.group?.name ?? ""),
            theme: String(r?.reason_json?.group?.theme ?? ""),
          })),
        } as any)
        : dateUsed
        ? await (supabase as any)
            .from("daily_scans")
            .select(
              "symbol,signal,confidence,entry,stop,tp1,tp2,rank,rank_score,reason_summary,reason_json"
            )
            .eq("universe_slug", mappedUniverse)
            .eq("strategy_version", strategyVersion)
            .eq("date", dateUsed)
            .order("rank", { ascending: true, nullsFirst: false })
            .order("confidence", { ascending: false })
            .order("symbol", { ascending: true })
            .limit(200)
        : ({ data: [] } as any);

    let nonSectorRows = ((rows ?? []) as any[]) || [];
    if (!isSectorMomentum && nonSectorRows.length === 0 && !requestedDate) {
      const { data: latestDateRow } = await (supabase as any)
        .from("daily_scans")
        .select("date")
        .eq("universe_slug", mappedUniverse)
        .eq("strategy_version", strategyVersion)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const fallbackDate = latestDateRow?.date ? String(latestDateRow.date) : null;
      if (fallbackDate && fallbackDate !== nonSectorDateUsed) {
        nonSectorDateUsed = fallbackDate;
        const { data: fallbackRows } = await (supabase as any)
          .from("daily_scans")
          .select(
            "symbol,signal,confidence,entry,stop,tp1,tp2,rank,rank_score,reason_summary,reason_json"
          )
          .eq("universe_slug", mappedUniverse)
          .eq("strategy_version", strategyVersion)
          .eq("date", nonSectorDateUsed)
          .order("rank", { ascending: true, nullsFirst: false })
          .order("confidence", { ascending: false })
          .order("symbol", { ascending: true })
          .limit(200);
        nonSectorRows = (fallbackRows ?? []) as any[];
        nonSectorSource = "daily_scans_cache_fallback_latest_date";
      }
    }

    const breadth = isSectorMomentum
      ? computeSectorBreadth((rows ?? []) as ScanRow[], regimeState)
      : await computeMarketBreadth({
          supabase: supabase as any,
          date: nonSectorDateUsed ?? null,
          universe_slug: mappedUniverse,
          strategy_version: strategyVersion,
          regime_state: regimeState,
        });

    const capacity = await getActivePortfolioCapacity({
      supabase: supabase as any,
      userId,
    });

    const rawRows = (isSectorMomentum ? (rows ?? []) : nonSectorRows) as ScanRow[];
    if (isSectorMomentum) {
      console.info("[sector_momentum][screener-data]", {
        requested_date: dateUsed,
        date_used: sectorDateUsed,
        universe_slug: mappedUniverse,
        strategy_version: strategyVersion,
        rows_returned: rawRows.length,
        source: sectorSource,
      });
    }
    let entryValidatedRows = rawRows;
    if (nonSectorDateUsed && rawRows.length > 0 && !isSectorMomentum) {
      const symbols = Array.from(new Set(rawRows.map((r) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean)));
      const { data: barsOnDate } = await (supabase as any)
        .from("price_bars")
        .select("symbol,close,date")
        .eq("date", nonSectorDateUsed)
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

    return {
      ok: true,
      meta: {
        date_used: isSectorMomentum ? sectorDateUsed ?? null : nonSectorDateUsed ?? null,
        lctd: lctd.lctd,
        lctd_source: lctd.source,
        data_source: isSectorMomentum ? sectorSource : nonSectorSource,
        rows_raw_count: rawRows.length,
        rows_after_validation_count: entryValidatedRows.length,
        rows_display_count: rowsFinal.length,
        regime_state: regimeState,
        regime_date: regimeDate,
        regime_stale: regimeStale,
        sector_momentum: isSectorMomentum
          ? {
                universe_slug: mappedUniverse,
                strategy_universe_slug: mappedUniverse,
                top_group_count: 4,
                source: sectorSource,
                date_used: sectorDateUsed,
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
    const universeSlug = String(url.searchParams.get("universe_slug") ?? DEFAULT_UNIVERSE).trim() || DEFAULT_UNIVERSE;
    const date = String(url.searchParams.get("date") ?? "").trim() || null;

    const data = await loadScreenerDataCached(user.id, universeSlug, strategyVersion, date);
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
