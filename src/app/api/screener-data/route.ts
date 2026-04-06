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
import { buildIdeaDossier } from "@/lib/idea_dossier";
import { computeDailySymbolFact } from "@/lib/daily_symbol_facts";
import { blockerCounts, compareIdeaProgress, sortClosestToActionable } from "@/lib/idea_progress";
import { buildPortfolioFit, summarizePortfolioFit, type HeldPositionContext } from "@/lib/portfolio_fit";
import { buildIdeaTransitionPlan } from "@/lib/idea_transition";
import { buildIdeaLeadershipContext } from "@/lib/idea_leadership";
import {
  SECTOR_MOMENTUM_STRATEGY_VERSION,
  computeSectorMomentum,
  INDUSTRY_GROUPS,
} from "@/lib/sector_momentum";
import { allowedUniversesForStrategy, defaultUniverseForStrategy } from "@/lib/strategy_universe";
import { OBS_KEYS } from "@/lib/observability";

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
  setup_type?: string | null;
  candidate_state?: string | null;
  candidate_state_label?: string | null;
  blockers?: string[] | null;
  watch_items?: string[] | null;
  dossier_summary?: string | null;
  symbol_facts?: Record<string, unknown> | null;
  change_status?: "NEW" | "UPGRADED" | "UNCHANGED" | "DOWNGRADED" | null;
  change_label?: string | null;
  prior_signal?: "BUY" | "WATCH" | "AVOID" | null;
  prior_quality_score?: number | null;
  prior_date?: string | null;
  action?: "BUY_NOW" | "WAIT" | "SKIP";
  action_reason?: string | null;
  sizing?: {
    shares: number;
    est_cost: number;
    risk_per_share: number;
    risk_budget: number;
    shares_by_risk?: number;
    shares_by_cash?: number;
    shares_by_portfolio_cap?: number | null;
    limiting_factor?: "risk" | "cash" | "portfolio_cap" | "none";
    sizing_mode?: "cash_only";
  } | null;
  portfolio_fit?: {
    fit_state: "GOOD_FIT" | "ALREADY_HELD" | "CAPACITY_LIMITED" | "CROWDED" | "REVIEW";
    fit_label: string;
    fit_score: number;
    summary: string;
    blockers: string[];
    watch_items: string[];
    already_held: boolean;
    open_positions_count: number;
    same_industry_count: number;
    same_theme_count: number;
    cash_available: number;
    slots_left: number;
    estimated_cost: number | null;
  } | null;
  transition_plan?: {
    summary: string;
    next_action: string;
    triggers_to_buy: string[];
    strengths_now: string[];
    invalidation_watch: string[];
  } | null;
  leadership_context?: {
    state: "LEADING" | "IMPROVING" | "WEAK" | "UNKNOWN";
    label: string;
    summary: string;
    strengths: string[];
    warnings: string[];
    industry_group: string | null;
    theme: string | null;
    group_rank_score: number | null;
  } | null;
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

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function previousWeekday(date: string) {
  let current = date;
  while (true) {
    current = shiftDate(current, -1);
    const day = new Date(`${current}T00:00:00Z`).getUTCDay();
    if (day >= 1 && day <= 5) return current;
  }
}

function latestCompletedUsTradingDay() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour") || "0");
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday === 0) return previousWeekday(today);
  if (weekday === 6) return previousWeekday(today);
  return hour >= 18 ? today : previousWeekday(today);
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
    const sectorLeadership = await computeSectorMomentum({
      supabase: supabase as any,
      scan_date: resolvedDateUsed ?? null,
      lctd_source: lctd.source as any,
    });
    const sectorGroupByName = new Map(
      (Array.isArray(sectorLeadership.groups) ? sectorLeadership.groups : []).map((group) => [group.name, group] as const)
    );
    const industryGroupBySymbol = new Map<string, { name: string; theme: string }>();
    for (const group of INDUSTRY_GROUPS) {
      for (const symbol of group.symbols) {
        const sym = String(symbol ?? "").trim().toUpperCase();
        if (!sym || industryGroupBySymbol.has(sym)) continue;
        industryGroupBySymbol.set(sym, { name: group.name, theme: group.theme });
      }
    }

    const capacity = await getActivePortfolioCapacity({
      supabase: supabase as any,
      userId,
    });
    const portfolioId = String(capacity?.portfolio_id ?? "").trim();
    let heldPositions: HeldPositionContext[] = [];
    if (portfolioId) {
      const { data: openPositions } = await (supabase as any)
        .from("portfolio_positions")
        .select("symbol,strategy_version,status")
        .eq("portfolio_id", portfolioId)
        .eq("status", "OPEN");
      const heldSymbols = Array.from(
        new Set(
          (Array.isArray(openPositions) ? openPositions : [])
            .map((row: any) => String(row?.symbol ?? "").trim().toUpperCase())
            .filter(Boolean)
        )
      );
      const metadataBySymbol = new Map<string, { industry_group?: string | null; theme?: string | null }>();
      if (heldSymbols.length > 0) {
        for (const row of rawRows) {
          const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
          if (!symbol || metadataBySymbol.has(symbol)) continue;
          const industryGroup = String((row as any)?.industry_group ?? "").trim() || null;
          const theme = String((row as any)?.theme ?? "").trim() || null;
          if (industryGroup || theme) metadataBySymbol.set(symbol, { industry_group: industryGroup, theme });
        }
        const { data: heldScanRows } = await (supabase as any)
          .from("daily_scans")
          .select("symbol,date,reason_json")
          .in("symbol", heldSymbols)
          .order("date", { ascending: false });
        for (const row of Array.isArray(heldScanRows) ? heldScanRows : []) {
          const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
          if (!symbol || metadataBySymbol.has(symbol)) continue;
          const group = (row as any)?.reason_json?.group ?? null;
          const industryGroup = String(group?.name ?? "").trim() || null;
          const theme = String(group?.theme ?? "").trim() || null;
          if (industryGroup || theme) metadataBySymbol.set(symbol, { industry_group: industryGroup, theme });
        }
      }
      heldPositions = (Array.isArray(openPositions) ? openPositions : []).map((row: any) => {
        const symbol = String(row?.symbol ?? "").trim().toUpperCase();
        const metadata = metadataBySymbol.get(symbol);
        return {
          symbol,
          strategy_version: row?.strategy_version ? String(row.strategy_version) : null,
          industry_group: metadata?.industry_group ?? null,
          theme: metadata?.theme ?? null,
        } satisfies HeldPositionContext;
      });
    }

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

    let factsBySymbol = new Map<string, Record<string, unknown>>();
    if (resolvedDateUsed && entryValidatedRows.length > 0) {
      const factSymbols = Array.from(
        new Set(entryValidatedRows.map((row) => String(row.symbol ?? "").trim().toUpperCase()).filter(Boolean))
      );
      const { data: factRows, error: factError } = await (supabase as any)
        .from("daily_symbol_facts")
        .select(
          "symbol,close,sma20,sma50,sma200,above_sma20,above_sma50,above_sma200,atr14,atr_ratio,avg_volume20,avg_dollar_volume20,relative_volume,high_30bar,low_30bar,drop_from_30bar_high_pct,distance_from_sma20_pct,distance_from_sma50_pct,distance_from_sma200_pct,trend_state,extension_state,liquidity_state,volatility_state"
        )
        .eq("date", resolvedDateUsed)
        .in("symbol", factSymbols);
      if (!factError && Array.isArray(factRows)) {
        factsBySymbol = new Map(
          factRows.map((row: any) => [
            String(row?.symbol ?? "").trim().toUpperCase(),
            {
              close: row?.close ?? null,
              sma20: row?.sma20 ?? null,
              sma50: row?.sma50 ?? null,
              sma200: row?.sma200 ?? null,
              above_sma20: row?.above_sma20 ?? null,
              above_sma50: row?.above_sma50 ?? null,
              above_sma200: row?.above_sma200 ?? null,
              atr14: row?.atr14 ?? null,
              atr_ratio: row?.atr_ratio ?? null,
              avg_volume20: row?.avg_volume20 ?? null,
              avg_dollar_volume20: row?.avg_dollar_volume20 ?? null,
              relative_volume: row?.relative_volume ?? null,
              high_30bar: row?.high_30bar ?? null,
              low_30bar: row?.low_30bar ?? null,
              drop_from_30bar_high_pct: row?.drop_from_30bar_high_pct ?? null,
              distance_from_sma20_pct: row?.distance_from_sma20_pct ?? null,
              distance_from_sma50_pct: row?.distance_from_sma50_pct ?? null,
              distance_from_sma200_pct: row?.distance_from_sma200_pct ?? null,
              trend_state: row?.trend_state ?? null,
              extension_state: row?.extension_state ?? null,
              liquidity_state: row?.liquidity_state ?? null,
              volatility_state: row?.volatility_state ?? null,
            } satisfies Record<string, unknown>,
          ])
        );
      }
      if (factsBySymbol.size === 0 && factSymbols.length > 0) {
        const { data: factBars, error: factBarsError } = await (supabase as any)
          .from("price_bars")
          .select("symbol,date,open,high,low,close,volume")
          .in("symbol", factSymbols)
          .eq("source", "polygon")
          .lte("date", resolvedDateUsed)
          .order("symbol", { ascending: true })
          .order("date", { ascending: false });
        if (!factBarsError && Array.isArray(factBars)) {
          const grouped = new Map<string, Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>();
          for (const row of factBars) {
            const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
            if (!symbol) continue;
            const existing = grouped.get(symbol) ?? [];
            if (existing.length >= 300) continue;
            existing.push({
              date: String((row as any)?.date ?? ""),
              open: Number((row as any)?.open ?? 0),
              high: Number((row as any)?.high ?? 0),
              low: Number((row as any)?.low ?? 0),
              close: Number((row as any)?.close ?? 0),
              volume: Number((row as any)?.volume ?? 0),
            });
            grouped.set(symbol, existing);
          }
          for (const [symbol, barsDesc] of grouped.entries()) {
            const barsAsc = [...barsDesc].reverse();
            const fact = computeDailySymbolFact({
              symbol,
              scanDate: resolvedDateUsed,
              barsAsc,
            });
            if (!fact) continue;
            factsBySymbol.set(symbol, {
              close: fact.close,
              sma20: fact.sma20,
              sma50: fact.sma50,
              sma200: fact.sma200,
              above_sma20: fact.above_sma20,
              above_sma50: fact.above_sma50,
              above_sma200: fact.above_sma200,
              atr14: fact.atr14,
              atr_ratio: fact.atr_ratio,
              avg_volume20: fact.avg_volume20,
              avg_dollar_volume20: fact.avg_dollar_volume20,
              relative_volume: fact.relative_volume,
              high_30bar: fact.high_30bar,
              low_30bar: fact.low_30bar,
              drop_from_30bar_high_pct: fact.drop_from_30bar_high_pct,
              distance_from_sma20_pct: fact.distance_from_sma20_pct,
              distance_from_sma50_pct: fact.distance_from_sma50_pct,
              distance_from_sma200_pct: fact.distance_from_sma200_pct,
              trend_state: fact.trend_state,
              extension_state: fact.extension_state,
              liquidity_state: fact.liquidity_state,
              volatility_state: fact.volatility_state,
            });
          }
        }
      }
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
      const dossier = buildIdeaDossier({
        strategy_version: strategyVersion,
        signal: row.signal,
        quality_score:
          typeof persistedSignalQuality?.quality_score === "number"
            ? Number(persistedSignalQuality.quality_score)
            : Number(quality.quality_score ?? 0),
        quality_signal:
          persistedSignalQuality?.quality_signal === "BUY" ||
          persistedSignalQuality?.quality_signal === "WATCH" ||
          persistedSignalQuality?.quality_signal === "AVOID"
            ? persistedSignalQuality.quality_signal
            : (quality as any).quality_signal ?? null,
        quality_summary:
          typeof persistedSignalQuality?.summary === "string"
            ? persistedSignalQuality.summary
            : typeof (quality as any).quality_summary === "string"
              ? (quality as any).quality_summary
              : null,
        action: action.action,
        action_reason: action.action_reason,
        trade_risk_layer: (persistedTradeRisk as any) ?? tradeRisk,
        reason_summary: row.reason_summary ?? null,
        reason_json: row.reason_json ?? null,
      });
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
        quality_score:
          typeof persistedSignalQuality?.quality_score === "number" && Number.isFinite(persistedSignalQuality.quality_score)
            ? Number(persistedSignalQuality.quality_score)
            : Number((quality as any).quality_score ?? 0),
        risk_grade:
          persistedSignalQuality?.risk_grade === "A" ||
          persistedSignalQuality?.risk_grade === "B" ||
          persistedSignalQuality?.risk_grade === "C" ||
          persistedSignalQuality?.risk_grade === "D"
            ? persistedSignalQuality.risk_grade
            : ((quality as any).risk_grade ?? null),
        quality_signal:
          persistedSignalQuality?.quality_signal === "BUY" ||
          persistedSignalQuality?.quality_signal === "WATCH" ||
          persistedSignalQuality?.quality_signal === "AVOID"
            ? persistedSignalQuality.quality_signal
            : ((quality as any).quality_signal ?? null),
        quality_summary:
          typeof persistedSignalQuality?.summary === "string"
            ? persistedSignalQuality.summary
            : typeof (quality as any).quality_summary === "string"
              ? (quality as any).quality_summary
              : null,
        trade_risk_layer: persistedTradeRisk ?? tradeRisk,
        reason_summary: row.reason_summary ?? null,
        reason_json: row.reason_json ?? null,
        industry_group: row.industry_group ?? null,
        theme: row.theme ?? null,
        setup_type: dossier.setup_type,
        candidate_state: dossier.candidate_state,
        candidate_state_label: dossier.candidate_state_label,
        blockers: dossier.blockers,
        watch_items: dossier.watch_items,
        dossier_summary: dossier.dossier_summary,
        symbol_facts: factsBySymbol.get(String(row.symbol ?? "").trim().toUpperCase()) ?? null,
        atr14: null,
        event_risk: false,
        news_risk: false,
        action: action.action,
        action_reason: action.action_reason,
        sizing: action.sizing,
        leadership_context: null,
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
    let rowsFinal: ScanRow[] = withActions.map((row) =>
      row.action === "BUY_NOW" && !keepBuyNow.has(row.symbol)
        ? { ...row, action: "WAIT" as const, action_reason: "Prioritize top 3 actionable today" }
        : row
    );

    const priorSymbols = Array.from(
      new Set(rowsFinal.map((row) => String(row.symbol ?? "").trim().toUpperCase()).filter(Boolean))
    );
    const priorUniverses = Array.from(
      new Set(rowsFinal.map((row) => String(row.universe_slug ?? "").trim()).filter(Boolean))
    );
    let priorByKey = new Map<string, { symbol: string; universe_slug: string; date: string; signal: "BUY" | "WATCH" | "AVOID"; quality_score: number | null }>();
    if (priorSymbols.length > 0 && priorUniverses.length > 0) {
      const earliestCurrentDate = rowsFinal
        .map((row) => String(row.source_scan_date ?? "").trim())
        .filter(Boolean)
        .sort()[0] ?? null;
      if (earliestCurrentDate) {
        const { data: priorRows } = await (supabase as any)
          .from("daily_scans")
          .select("symbol,universe_slug,date,signal,quality_score,reason_json")
          .eq("strategy_version", strategyVersion)
          .in("symbol", priorSymbols)
          .in("universe_slug", priorUniverses)
          .lt("date", earliestCurrentDate)
          .order("date", { ascending: false });
        for (const row of Array.isArray(priorRows) ? priorRows : []) {
          const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
          const universe = String((row as any)?.universe_slug ?? "").trim();
          const date = String((row as any)?.date ?? "").trim();
          if (!symbol || !universe || !date) continue;
          const key = `${symbol}__${universe}`;
          if (priorByKey.has(key)) continue;
          const persistedQuality = Number((row as any)?.quality_score);
          const fallbackQuality = Number((row as any)?.reason_json?.signal_quality?.quality_score);
          priorByKey.set(key, {
            symbol,
            universe_slug: universe,
            date,
            signal:
              (row as any)?.signal === "BUY" || (row as any)?.signal === "WATCH" || (row as any)?.signal === "AVOID"
                ? (row as any).signal
                : "AVOID",
            quality_score: Number.isFinite(persistedQuality)
              ? persistedQuality
              : Number.isFinite(fallbackQuality)
                ? fallbackQuality
                : null,
          });
        }
      }
    }

    rowsFinal = rowsFinal.map((row) => {
      const key = `${String(row.symbol ?? "").trim().toUpperCase()}__${String(row.universe_slug ?? "").trim()}`;
      const progress = compareIdeaProgress(row as any, priorByKey.get(key) ?? null);
      return {
        ...row,
        change_status: progress.status,
        change_label: progress.label,
        prior_signal: progress.prior_signal,
        prior_quality_score: progress.prior_quality_score,
        prior_date: progress.prior_date,
      };
    });
    rowsFinal = rowsFinal.map((row) => ({
      ...row,
      portfolio_fit: buildPortfolioFit(
        {
          symbol: row.symbol,
          industry_group: row.industry_group ?? null,
          theme: row.theme ?? null,
          candidate_state: row.candidate_state ?? null,
          action: row.action ?? null,
          action_reason: row.action_reason ?? null,
          sizing: row.sizing ?? null,
        },
        {
          held_positions: heldPositions,
          capacity,
        }
      ),
    }));
    rowsFinal = rowsFinal.map((row) => ({
      ...row,
      transition_plan: buildIdeaTransitionPlan({
        strategy_version: strategyVersion,
        signal: row.signal,
        action: row.action ?? null,
        action_reason: row.action_reason ?? null,
        candidate_state: row.candidate_state ?? null,
        blockers: row.blockers ?? [],
        watch_items: row.watch_items ?? [],
        symbol_facts: (row.symbol_facts as any) ?? null,
        portfolio_fit: (row.portfolio_fit as any) ?? null,
      }),
    }));
    rowsFinal = rowsFinal.map((row) => {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      const fallbackGroup = industryGroupBySymbol.get(symbol);
      const industryGroup = row.industry_group ?? fallbackGroup?.name ?? null;
      const theme = row.theme ?? fallbackGroup?.theme ?? null;
      const leadershipGroup = industryGroup ? sectorGroupByName.get(industryGroup) ?? null : null;
      return {
        ...row,
        leadership_context: buildIdeaLeadershipContext({
          industry_group: industryGroup,
          theme,
          group: leadershipGroup,
        }),
        industry_group: industryGroup,
        theme,
      };
    });

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
    const candidateStateCounts = {
      actionable_today: rowsFinal.filter((r) => r.candidate_state === "ACTIONABLE_TODAY").length,
      near_entry: rowsFinal.filter((r) => r.candidate_state === "NEAR_ENTRY").length,
      quality_watch: rowsFinal.filter((r) => r.candidate_state === "QUALITY_WATCH").length,
      extended_leader: rowsFinal.filter((r) => r.candidate_state === "EXTENDED_LEADER").length,
      blocked: rowsFinal.filter((r) => r.candidate_state === "BLOCKED").length,
      avoid: rowsFinal.filter((r) => r.candidate_state === "AVOID" || !r.candidate_state).length,
    };
    const closestToActionable = sortClosestToActionable(
      rowsFinal.filter((row) => row.candidate_state !== "ACTIONABLE_TODAY" && row.signal !== "AVOID")
    )
      .slice(0, 5)
      .map((row) => ({
        symbol: row.symbol,
        candidate_state: row.candidate_state ?? null,
        candidate_state_label: row.candidate_state_label ?? null,
        quality_score: row.quality_score ?? null,
        blockers: row.blockers ?? [],
        dossier_summary: row.dossier_summary ?? null,
      }));
    const improvingRows = rowsFinal
      .filter((row) => row.change_status === "NEW" || row.change_status === "UPGRADED")
      .sort((a, b) => {
        const statusRank = (row: typeof a) => (row.change_status === "NEW" ? 2 : row.change_status === "UPGRADED" ? 1 : 0);
        const rankDelta = statusRank(b) - statusRank(a);
        if (rankDelta !== 0) return rankDelta;
        const qa = typeof a.quality_score === "number" ? a.quality_score : 0;
        const qb = typeof b.quality_score === "number" ? b.quality_score : 0;
        if (qb !== qa) return qb - qa;
        return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
      })
      .slice(0, 5)
      .map((row) => ({
        symbol: row.symbol,
        change_status: row.change_status ?? null,
        change_label: row.change_label ?? null,
        candidate_state_label: row.candidate_state_label ?? null,
        quality_score: row.quality_score ?? null,
      }));
    const blockerSummary = blockerCounts(rowsFinal)
      .slice(0, 5)
      .map((row) => ({ label: row.label, count: row.count }));
    const changeSummary = {
      new_count: rowsFinal.filter((row) => row.change_status === "NEW").length,
      upgraded_count: rowsFinal.filter((row) => row.change_status === "UPGRADED").length,
      unchanged_count: rowsFinal.filter((row) => row.change_status === "UNCHANGED").length,
      downgraded_count: rowsFinal.filter((row) => row.change_status === "DOWNGRADED").length,
    };
    const portfolioFitSummary = summarizePortfolioFit(rowsFinal as Array<{ symbol: string; portfolio_fit?: any }>, heldPositions);
    const transitionSummary = {
      ready_now: rowsFinal.filter((row) => row.transition_plan?.next_action === "Ready to plan or paper trade now").length,
      needs_regime: rowsFinal.filter((row) => row.transition_plan?.triggers_to_buy?.some((item) => /SPY regime/i.test(item))).length,
      needs_pullback: rowsFinal.filter((row) => row.transition_plan?.triggers_to_buy?.some((item) => /pullback|buy zone/i.test(item))).length,
      needs_capacity: rowsFinal.filter((row) => row.transition_plan?.triggers_to_buy?.some((item) => /cash|slot/i.test(item))).length,
    };
    const leadershipSummary = {
      leading: rowsFinal.filter((row) => row.leadership_context?.state === "LEADING").length,
      improving: rowsFinal.filter((row) => row.leadership_context?.state === "IMPROVING").length,
      weak: rowsFinal.filter((row) => row.leadership_context?.state === "WEAK").length,
      unknown: rowsFinal.filter((row) => row.leadership_context?.state === "UNKNOWN" || !row.leadership_context).length,
    };
    const [coreStats, midcapStats, liquidStats, growthStats] = await Promise.all([
      latestUniverseStats(supabase as any, strategyVersion, "core_800"),
      latestUniverseStats(supabase as any, strategyVersion, "midcap_1000"),
      latestUniverseStats(supabase as any, strategyVersion, "liquid_2000"),
      latestUniverseStats(supabase as any, strategyVersion, "growth_1500"),
    ]);
    const { data: schedulerStatus } = await (supabase as any)
      .from("system_status")
      .select("updated_at,value")
      .eq("key", OBS_KEYS.scheduler)
      .maybeSingle();
    const schedulerValue = (schedulerStatus?.value ?? null) as any;
    const schedulerUpdatedAt = schedulerStatus?.updated_at ? String(schedulerStatus.updated_at) : null;
    const schedulerScanDate = schedulerValue?.scan_date_used ? String(schedulerValue.scan_date_used) : null;
    const expectedLatestTradingDay = latestCompletedUsTradingDay();
    const marketDataReasons: string[] = [];
    if (!lctd.lctd) {
      marketDataReasons.push("No price_bars LCTD available");
    } else if (lctd.lctd < expectedLatestTradingDay) {
      marketDataReasons.push(`LCTD ${lctd.lctd} is behind expected ${expectedLatestTradingDay}`);
    }
    if (!schedulerUpdatedAt) {
      marketDataReasons.push("No recent daily scheduler status found");
    } else if (schedulerScanDate && schedulerScanDate < expectedLatestTradingDay) {
      marketDataReasons.push(`Scheduler scan date ${schedulerScanDate} is behind expected ${expectedLatestTradingDay}`);
    }

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
        candidate_state_counts: candidateStateCounts,
        closest_to_actionable: closestToActionable,
        improving_rows: improvingRows,
        blocker_summary: blockerSummary,
        change_summary: changeSummary,
        portfolio_fit_summary: portfolioFitSummary,
        transition_summary: transitionSummary,
        leadership_summary: leadershipSummary,
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
        market_data_status: {
          is_stale: marketDataReasons.length > 0,
          reasons: marketDataReasons,
          expected_latest_trading_day: expectedLatestTradingDay,
          scheduler_last_run_at: schedulerUpdatedAt,
          scheduler_last_scan_date: schedulerScanDate,
          scheduler_last_ok: schedulerValue?.ok === true,
        },
        portfolio_context: {
          open_positions_count: heldPositions.length,
          cash_available: capacity?.cash_available ?? 0,
          slots_left: capacity?.slots_left ?? 0,
        },
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
