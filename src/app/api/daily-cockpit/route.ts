import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { loadTacticalMomentumPayloadForServer } from "@/app/api/tactical-momentum/route";
import { loadQualityDipPayloadForServer } from "@/app/api/quality-dip/route";
import { getMarketDataProvider, getMarketDataProviderInfo } from "@/lib/market-data";
import { latestCompletedUsTradingDay, marketSessionsBehind } from "@/lib/market-calendar";
import { getOrRepairDefaultPortfolio } from "@/lib/get_or_repair_default_portfolio";
import { getPortfolioSnapshot } from "@/lib/portfolio_snapshot";
import type {
  CockpitCandidate,
  CockpitExecutionState,
  CockpitPosition,
  DailyCockpitPayload,
} from "@/lib/daily_cockpit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type JsonRecord = Record<string, unknown>;

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return typeof error === "string" ? error : "Daily cockpit failed";
}

function daysBetween(start: string | null, end = new Date()) {
  if (!start) return null;
  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - parsed.getTime()) / 86_400_000));
}

function strategyLabel(version: string | null) {
  if (version === "quality_dip_v1") return "Quality Pullback";
  if (version === "tactical_momentum_v1") return "Fast Momentum";
  if (version === "v1_trend_hold") return "Trend Hold";
  if (version === "v1_sector_momentum") return "Sector Momentum";
  return "Momentum Swing";
}

function candidateExecution(args: {
  state: "ACT_NOW" | "NEAR_TRIGGER";
  currentPrice: number | null;
  entry: number | null;
  usesProviderSnapshot: boolean;
}): { state: CockpitExecutionState; label: string } {
  if (args.currentPrice == null || args.entry == null || args.entry <= 0) {
    return { state: "CACHED_CLOSE_ONLY", label: "Price alignment unavailable" };
  }
  const delta = ((args.currentPrice - args.entry) / args.entry) * 100;
  if (delta > 2.5) return { state: "DO_NOT_CHASE", label: "Above plan — do not chase" };
  if (args.state === "NEAR_TRIGGER") {
    if (delta >= -0.25) return { state: "AT_TRIGGER_WAIT_CONFIRMATION", label: "At trigger — confirm on daily setup" };
    return { state: "WAIT_FOR_TRIGGER", label: "Wait for trigger" };
  }
  if (delta < -1.5) return { state: "WAIT_FOR_TRIGGER", label: "Below entry reference — reassess" };
  return {
    state: "ENTRY_ALIGNED",
    label: args.usesProviderSnapshot ? "Current price aligned with plan" : "Completed close aligned with plan",
  };
}

function ticketHref(args: {
  strategy: "tactical_momentum" | "quality_dip";
  symbol: string;
  signal: "BUY" | "WATCH";
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  reason: string;
  sourceDate: string | null;
  universe: string;
}) {
  const params = new URLSearchParams({
    strategy: args.strategy,
    symbol: args.symbol,
    open_ticket: "1",
    manual_signal: args.signal,
    manual_reason_summary: args.reason,
    manual_universe_slug: args.universe,
  });
  if (args.entry != null) params.set("manual_entry", String(args.entry));
  if (args.stop != null) params.set("manual_stop", String(args.stop));
  if (args.tp1 != null) params.set("manual_tp1", String(args.tp1));
  if (args.tp2 != null) params.set("manual_tp2", String(args.tp2));
  if (args.sourceDate) params.set("manual_scan_date", args.sourceDate);
  return `/ideas?${params.toString()}`;
}

const loadTacticalCached = unstable_cache(
  async (sourceDate: string | null) => {
    return loadTacticalMomentumPayloadForServer(
      new Request(`http://daily-cockpit.local/api/tactical-momentum?limit=225&source_date=${sourceDate ?? "none"}`)
    );
  },
  ["daily-cockpit-tactical-v2"],
  { revalidate: 900 }
);

const loadQualityCached = unstable_cache(
  async (sourceDate: string | null) => {
    void sourceDate;
    return loadQualityDipPayloadForServer();
  },
  ["daily-cockpit-quality-v2"],
  { revalidate: 900 }
);

function mapTacticalRow(row: JsonRecord): CockpitCandidate | null {
  const signal = String(row.signal ?? "").toUpperCase();
  const timing = String(row.timing_state ?? "").toUpperCase();
  const state = signal === "BUY" && timing === "BUY_READY" ? "ACT_NOW" : signal === "WATCH" ? "NEAR_TRIGGER" : null;
  if (!state) return null;
  const symbol = String(row.symbol ?? "").trim().toUpperCase();
  if (!symbol) return null;
  const entry = numberOrNull(row.entry_price);
  const stop = numberOrNull(row.stop_price);
  const tp1 = numberOrNull(row.tp1_price);
  const tp2 = numberOrNull(row.tp2_price);
  const sourceDate = row.source_date ? String(row.source_date) : null;
  const reason = String(row.reason_summary ?? "Tactical momentum setup from completed daily bars.");
  const distance = numberOrNull(row.distance_to_breakout_pct);
  const relativeVolume = numberOrNull(row.relative_volume);
  return {
    symbol,
    name: String(row.name ?? symbol),
    playbook: "FAST_MOMENTUM",
    playbook_label: "Fast Momentum",
    strategy_version: "tactical_momentum_v1",
    universe_slug: "tactical_momentum_market",
    state,
    state_label: state === "ACT_NOW" ? "Act now" : "Near trigger",
    setup_label: String(row.setup_type ?? "Momentum setup"),
    score: numberOrNull(row.ranking_score),
    reference_price: numberOrNull(row.current_price),
    quote_price: null,
    quote_as_of: null,
    quote_source: "cached_daily_close",
    entry_price: entry,
    stop_price: stop,
    tp1_price: tp1,
    tp2_price: tp2,
    target_model: row.target_model ? String(row.target_model) : null,
    tp1_reason: row.tp1_reason ? String(row.tp1_reason) : null,
    tp2_reason: row.tp2_reason ? String(row.tp2_reason) : null,
    expected_hold: "2–7 sessions",
    source_date: sourceDate,
    reason_summary: reason,
    next_trigger:
      state === "ACT_NOW"
        ? "Enter only near the planned level; skip if price gaps materially above it."
        : distance != null
          ? `Watch for a confirmed move through the breakout area (${distance.toFixed(1)}% away at the completed close).`
          : "Wait for the daily breakout trigger with supportive volume.",
    execution_state: "CACHED_CLOSE_ONLY",
    execution_label: "Plan from completed close",
    ticket_href: ticketHref({
      strategy: "tactical_momentum",
      symbol,
      signal: state === "ACT_NOW" ? "BUY" : "WATCH",
      entry,
      stop,
      tp1,
      tp2,
      reason,
      sourceDate,
      universe: "tactical_momentum_market",
    }),
    details: [
      { label: "Breakout", value: row.breakout_level == null ? "—" : `$${Number(row.breakout_level).toFixed(2)}` },
      { label: "Rel. volume", value: relativeVolume == null ? "—" : `${relativeVolume.toFixed(2)}x` },
      { label: "Day move", value: row.day_change_pct == null ? "—" : `${Number(row.day_change_pct).toFixed(1)}%` },
    ],
  };
}

function mapQualityRow(row: JsonRecord): CockpitCandidate | null {
  const signal = String(row.signal ?? "").toUpperCase();
  const state = signal === "CONSIDER_BUY" ? "ACT_NOW" : signal === "WATCH" ? "NEAR_TRIGGER" : null;
  if (!state) return null;
  const symbol = String(row.symbol ?? "").trim().toUpperCase();
  if (!symbol) return null;
  const entry = numberOrNull(row.entry_price);
  const stop = numberOrNull(row.stop_price);
  const tp1 = numberOrNull(row.tp1_price);
  const tp2 = numberOrNull(row.tp2_price);
  const sourceDate = row.source_date ? String(row.source_date) : null;
  const reason = String(row.reason_summary ?? "Quality pullback setup from completed daily bars.");
  const drop = numberOrNull(row.drop_pct_from_30d_high);
  const score = signal === "CONSIDER_BUY" ? 88 - Math.abs((drop ?? 7.5) - 7.5) * 2 : 62 - Math.abs((drop ?? 7.5) - 7.5);
  return {
    symbol,
    name: String(row.name ?? symbol),
    playbook: "QUALITY_PULLBACK",
    playbook_label: "Quality Pullback",
    strategy_version: "quality_dip_v1",
    universe_slug: "quality_dip_watchlist",
    state,
    state_label: state === "ACT_NOW" ? "Act now" : "Near trigger",
    setup_label: "30-bar pullback",
    score: round2(score),
    reference_price: numberOrNull(row.current_price),
    quote_price: null,
    quote_as_of: null,
    quote_source: "cached_daily_close",
    entry_price: entry,
    stop_price: stop,
    tp1_price: tp1,
    tp2_price: tp2,
    target_model: row.target_model ? String(row.target_model) : "chart-derived resistance targets",
    tp1_reason: row.tp1_reason ? String(row.tp1_reason) : null,
    tp2_reason: row.tp2_reason ? String(row.tp2_reason) : null,
    expected_hold: "3–15 sessions",
    source_date: sourceDate,
    reason_summary: reason,
    next_trigger:
      state === "ACT_NOW"
        ? "Use the planned stop and avoid entering after a sharp gap away from the reference close."
        : drop != null && drop < 5
          ? "Wait for the pullback to enter the 5–10% preferred dip zone while trend remains intact."
          : drop != null && drop > 10
            ? "Wait for price to stabilize and recover into the preferred dip range."
            : "Wait for the weak confirmation to improve before entry.",
    execution_state: "CACHED_CLOSE_ONLY",
    execution_label: "Plan from completed close",
    ticket_href: ticketHref({
      strategy: "quality_dip",
      symbol,
      signal: state === "ACT_NOW" ? "BUY" : "WATCH",
      entry,
      stop,
      tp1,
      tp2,
      reason,
      sourceDate,
      universe: "quality_dip_watchlist",
    }),
    details: [
      { label: "30-bar high", value: row.high_30d == null ? "—" : `$${Number(row.high_30d).toFixed(2)}` },
      { label: "Pullback", value: drop == null ? "—" : `${drop.toFixed(1)}%` },
      { label: "Trend", value: row.stock_above_sma200 === true ? "Above SMA200" : "Trend needs repair" },
    ],
  };
}

function groupPositions(rows: JsonRecord[], cachedPriceBySymbol: Map<string, number>): CockpitPosition[] {
  const groups = new Map<string, JsonRecord[]>();
  for (const row of rows) {
    const symbol = String(row.symbol ?? "").trim().toUpperCase();
    if (!symbol) continue;
    groups.set(symbol, [...(groups.get(symbol) ?? []), row]);
  }
  return [...groups.entries()].map(([symbol, lots]) => {
    const weighted = (field: string) => {
      let numerator = 0;
      let denominator = 0;
      for (const lot of lots) {
        const qty = numberOrNull(lot.shares) ?? numberOrNull(lot.quantity) ?? numberOrNull(lot.position_size) ?? 0;
        const value = numberOrNull(lot[field]);
        if (qty <= 0 || value == null) continue;
        numerator += qty * value;
        denominator += qty;
      }
      return denominator > 0 ? numerator / denominator : null;
    };
    const quantity = lots.reduce(
      (sum, lot) => sum + (numberOrNull(lot.shares) ?? numberOrNull(lot.quantity) ?? numberOrNull(lot.position_size) ?? 0),
      0
    );
    const averageEntry = weighted("entry_price");
    const stop = weighted("stop_price") ?? weighted("stop");
    const tp1 = weighted("tp1_price");
    const tp2 = weighted("tp2_price");
    const current = cachedPriceBySymbol.get(symbol) ?? null;
    const entryDates = lots
      .map((lot) => String(lot.entry_date ?? lot.created_at ?? ""))
      .filter(Boolean)
      .sort();
    const heldDays = daysBetween(entryDates[0] ?? null);
    const maxHoldDays = lots
      .map((lot) => numberOrNull(lot.max_hold_days))
      .filter((value): value is number => value != null && value > 0)
      .sort((a, b) => a - b)[0] ?? null;
    let managementState: CockpitPosition["management_state"] = "HOLD";
    let managementLabel = "Hold to plan";
    let managementSummary = "Price remains between the stored stop and target levels.";
    if (current != null && stop != null && current <= stop) {
      managementState = "STOP_BREACHED";
      managementLabel = "Stop breached";
      managementSummary = "The completed close is at or below the stored stop. Review the exit now.";
    } else if (current != null && tp2 != null && current >= tp2) {
      managementState = "TP2_REACHED";
      managementLabel = "TP2 reached";
      managementSummary = "The completed close reached the second target. Review the remaining quantity.";
    } else if (current != null && tp1 != null && current >= tp1) {
      managementState = "TP1_REACHED";
      managementLabel = "TP1 reached";
      managementSummary = "The completed close reached the first target. Review a planned partial exit.";
    } else if (heldDays != null && maxHoldDays != null && heldDays >= maxHoldDays) {
      managementState = "TIME_REVIEW";
      managementLabel = "Time review due";
      managementSummary = "The planned holding window has elapsed. Reassess or close the position.";
    }
    const version = lots[0]?.strategy_version ? String(lots[0].strategy_version) : null;
    return {
      symbol,
      strategy_version: version,
      strategy_label: strategyLabel(version),
      lots: lots.length,
      quantity: Math.round(quantity),
      average_entry: round2(averageEntry),
      current_price: round2(current),
      quote_as_of: null,
      stop_price: round2(stop),
      tp1_price: round2(tp1),
      tp2_price: round2(tp2),
      unrealized_pct: averageEntry != null && current != null && averageEntry > 0 ? round2(((current - averageEntry) / averageEntry) * 100) : null,
      management_state: managementState,
      management_label: managementLabel,
      management_summary: managementSummary,
      held_days: heldDays,
      max_hold_days: maxHoldDays,
    };
  });
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const cookieStore = await cookies();
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => undefined } }
    );
    const { data: authData } = await authClient.auth.getUser();
    if (!authData.user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ ok: false, error: "Missing Supabase environment" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: spyRows } = await supabase
      .from("price_bars")
      .select("date,close,source")
      .eq("symbol", "SPY")
      .eq("source", "polygon")
      .order("date", { ascending: false })
      .limit(1);
    const sourceDate = spyRows?.[0]?.date ? String(spyRows[0].date) : null;
    const expectedDate = latestCompletedUsTradingDay();

    const defaultPortfolioPromise = getOrRepairDefaultPortfolio({ supabase, user_id: authData.user.id });
    const [tacticalPayload, qualityPayload, defaultPortfolio] = await Promise.all([
      loadTacticalCached(sourceDate),
      loadQualityCached(sourceDate),
      defaultPortfolioPromise,
    ]);

    const portfolioId = String(defaultPortfolio?.id ?? "");
    const { data: openRows } = portfolioId
      ? await supabase.from("portfolio_positions").select("*").eq("portfolio_id", portfolioId).eq("status", "OPEN")
      : { data: [] };
    const openPositions = Array.isArray(openRows) ? (openRows as JsonRecord[]) : [];
    const positionSymbols = Array.from(new Set(openPositions.map((row) => String(row.symbol ?? "").trim().toUpperCase()).filter(Boolean)));
    const cachedPriceBySymbol = new Map<string, number>();
    if (positionSymbols.length > 0) {
      const { data: priceRows } = await supabase
        .from("price_bars")
        .select("symbol,date,close")
        .in("symbol", positionSymbols)
        .eq("source", "polygon")
        .order("symbol", { ascending: true })
        .order("date", { ascending: false });
      for (const row of priceRows ?? []) {
        const symbol = String(row.symbol ?? "").trim().toUpperCase();
        const close = numberOrNull(row.close);
        if (symbol && close != null && !cachedPriceBySymbol.has(symbol)) cachedPriceBySymbol.set(symbol, close);
      }
    }

    const tacticalOk = tacticalPayload.ok === true;
    const qualityOk = qualityPayload.ok === true;
    const tacticalRows = tacticalOk && Array.isArray(tacticalPayload.rows) ? (tacticalPayload.rows as JsonRecord[]) : [];
    const qualityRows = qualityOk && Array.isArray(qualityPayload.rows) ? (qualityPayload.rows as JsonRecord[]) : [];
    let candidates = [...tacticalRows.map(mapTacticalRow), ...qualityRows.map(mapQualityRow)].filter(
      (row): row is CockpitCandidate => Boolean(row)
    );

    const providerInfo = getMarketDataProviderInfo();
    const quoteSymbols = Array.from(
      new Set([
        ...candidates
          .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
          .slice(0, 14)
          .map((row) => row.symbol),
        ...positionSymbols,
      ])
    ).slice(0, 18);
    const quoteBySymbol = new Map<string, { price: number; as_of: string }>();
    if (providerInfo.configured && quoteSymbols.length > 0) {
      const provider = getMarketDataProvider();
      const quoteResults = await Promise.allSettled(quoteSymbols.map((symbol) => provider.fetchLatestQuote(symbol)));
      quoteResults.forEach((result, index) => {
        if (result.status !== "fulfilled" || !result.value) return;
        quoteBySymbol.set(quoteSymbols[index], { price: result.value.price, as_of: result.value.as_of });
      });
    }

    candidates = candidates.map((candidate) => {
      const quote = quoteBySymbol.get(candidate.symbol) ?? null;
      const execution = candidateExecution({
        state: candidate.state,
        currentPrice: quote?.price ?? candidate.reference_price,
        entry: candidate.entry_price,
        usesProviderSnapshot: Boolean(quote),
      });
      const sourceIsCurrent = candidate.source_date === expectedDate;
      const mustWait = candidate.state === "ACT_NOW" && (!sourceIsCurrent || execution.state !== "ENTRY_ALIGNED");
      return {
        ...candidate,
        state: mustWait ? "NEAR_TRIGGER" : candidate.state,
        state_label: mustWait ? (sourceIsCurrent ? "Wait" : "Refresh needed") : candidate.state_label,
        next_trigger: mustWait
          ? sourceIsCurrent
            ? execution.label
            : `Refresh completed daily bars; this setup is from ${candidate.source_date ?? "an unknown date"}.`
          : candidate.next_trigger,
        quote_price: quote?.price ?? null,
        quote_as_of: quote?.as_of ?? null,
        quote_source: quote ? "provider_snapshot" : "cached_daily_close",
        execution_state: execution.state,
        execution_label: execution.label,
      };
    });

    let positions = groupPositions(openPositions, cachedPriceBySymbol).map((position) => {
      const quote = quoteBySymbol.get(position.symbol);
      if (!quote || position.average_entry == null) return position;
      const current = quote.price;
      let managementState = position.management_state;
      let managementLabel = position.management_label;
      let managementSummary = position.management_summary;
      if (position.stop_price != null && current <= position.stop_price) {
        managementState = "STOP_BREACHED";
        managementLabel = "Stop breached";
        managementSummary = "Current provider price is at or below the stored stop. Review the exit now.";
      } else if (position.tp2_price != null && current >= position.tp2_price) {
        managementState = "TP2_REACHED";
        managementLabel = "TP2 reached";
        managementSummary = "Current provider price reached the second target. Review the remaining quantity.";
      } else if (position.tp1_price != null && current >= position.tp1_price) {
        managementState = "TP1_REACHED";
        managementLabel = "TP1 reached";
        managementSummary = "Current provider price reached the first target. Review a planned partial exit.";
      }
      return {
        ...position,
        current_price: round2(current),
        quote_as_of: quote.as_of,
        unrealized_pct: round2(((current - position.average_entry) / position.average_entry) * 100),
        management_state: managementState,
        management_label: managementLabel,
        management_summary: managementSummary,
      };
    });
    const managementOrder: Record<CockpitPosition["management_state"], number> = {
      STOP_BREACHED: 0,
      TP2_REACHED: 1,
      TP1_REACHED: 2,
      TIME_REVIEW: 3,
      HOLD: 4,
    };
    positions = positions.sort((a, b) => managementOrder[a.management_state] - managementOrder[b.management_state]);

    const actNow = candidates
      .filter((row) => row.state === "ACT_NOW")
      .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
      .slice(0, 6);
    const nearTrigger = candidates
      .filter((row) => row.state === "NEAR_TRIGGER")
      .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
      .slice(0, 10);
    const positionsToManage = positions.filter((position) => position.management_state !== "HOLD").length;
    const snapshot = portfolioId ? await getPortfolioSnapshot(supabase, portfolioId, false) : null;
    const tacticalMeta = (tacticalPayload.meta ?? {}) as JsonRecord;
    const qualityMeta = (qualityPayload.meta ?? {}) as JsonRecord;
    const tacticalMarket = (tacticalMeta.market ?? {}) as JsonRecord;
    const qualityMarket = (qualityMeta.market ?? {}) as JsonRecord;
    const spyHealthy =
      typeof tacticalMarket.spy_above_sma200 === "boolean"
        ? tacticalMarket.spy_above_sma200
        : typeof qualityMarket.spy_above_sma200 === "boolean"
          ? qualityMarket.spy_above_sma200
          : null;
    const warnings: string[] = [];
    if (!tacticalOk) warnings.push(`Fast Momentum unavailable: ${String(tacticalPayload.error ?? "unknown error")}`);
    if (!qualityOk) warnings.push(`Quality Pullback unavailable: ${String(qualityPayload.error ?? "unknown error")}`);
    const sessionsBehind = marketSessionsBehind(sourceDate, expectedDate);
    if (sessionsBehind != null && sessionsBehind > 0) warnings.push(`Daily bars are ${sessionsBehind} completed session(s) behind.`);
    if (!providerInfo.configured) warnings.push("Market-data provider is not configured; current-price overlays use cached closes.");

    const payload: DailyCockpitPayload = {
      ok: tacticalOk || qualityOk,
      generated_at: new Date().toISOString(),
      market: {
        provider_id: providerInfo.id,
        provider_label: providerInfo.label,
        provider_configured: providerInfo.configured,
        quote_mode: providerInfo.configured ? "provider_snapshot_with_cached_fallback" : "cached_daily_close_only",
        expected_completed_session: expectedDate,
        source_date: sourceDate,
        sessions_behind: sessionsBehind,
        freshness_state: sourceDate === expectedDate ? "current" : sourceDate ? "stale" : "unavailable",
        spy_healthy: spyHealthy,
        regime_label: spyHealthy === true ? "Constructive" : spyHealthy === false ? "Defensive" : "Unknown",
      },
      summary: {
        act_now: actNow.length,
        near_trigger: nearTrigger.length,
        positions_to_manage: positionsToManage,
        open_positions: positions.length,
      },
      act_now: actNow,
      near_trigger: nearTrigger,
      positions,
      portfolio: {
        cash_available: snapshot?.cash_available ?? null,
        account_size: snapshot?.account_size ?? null,
        open_symbols: snapshot?.open_symbols_count ?? positions.length,
      },
      sources: {
        tactical: {
          ok: tacticalOk,
          rows: tacticalRows.length,
          scanned_symbols: Number(tacticalMeta.scanned_symbols_count ?? tacticalRows.length),
          source_date: tacticalMarket.source_date ? String(tacticalMarket.source_date) : sourceDate,
          error: tacticalOk ? null : String(tacticalPayload.error ?? "unknown error"),
        },
        quality: {
          ok: qualityOk,
          rows: qualityRows.length,
          watchlist_size: Number(qualityMeta.watchlist_size ?? qualityRows.length),
          source_date: qualityMeta.source_date ? String(qualityMeta.source_date) : sourceDate,
          error: qualityOk ? null : String(qualityPayload.error ?? "unknown error"),
        },
      },
      warnings,
    };
    console.info("[daily-cockpit]", {
      user_id: authData.user.id,
      source_date: sourceDate,
      act_now: actNow.length,
      near_trigger: nearTrigger.length,
      open_positions: positions.length,
      provider_quotes: quoteBySymbol.size,
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    const message = errorMessage(error);
    console.error("[daily-cockpit][failed]", { error: message, duration_ms: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
