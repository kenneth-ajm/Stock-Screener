import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import { getLCTD } from "@/lib/scan_status";
import { getActivePortfolioCapacity } from "@/lib/portfolio_capacity";
import { computePortfolioAwareAction } from "@/lib/execution_action";
import { computeMarketBreadth } from "@/lib/market_breadth";

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY = "v2_core_momentum";
const BUY_CAP = 5;
const WATCH_CAP = 10;
const ENTRY_MISMATCH_THRESHOLD_PCT = 0.6;

type ScanRow = {
  symbol: string;
  signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  rank_score?: number | null;
  rank?: number | null;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  reason_summary?: string | null;
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

const loadScreenerDataCached = unstable_cache(
  async (userId: string, universeSlug: string, strategyVersion: string, requestedDate: string | null) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;

    const lctd = await getLCTD(supabase as any);
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
    const breadth = await computeMarketBreadth({
      supabase: supabase as any,
      date: dateUsed ?? null,
      universe_slug: universeSlug,
      strategy_version: strategyVersion,
      regime_state: regimeState,
    });

    const { data: rows } = dateUsed
      ? await (supabase as any)
          .from("daily_scans")
          .select(
            "symbol,signal,confidence,entry,stop,tp1,tp2,rank,rank_score,reason_summary"
          )
          .eq("universe_slug", universeSlug)
          .eq("strategy_version", strategyVersion)
          .eq("date", dateUsed)
          .order("rank", { ascending: true, nullsFirst: false })
          .order("confidence", { ascending: false })
          .order("symbol", { ascending: true })
          .limit(200)
      : ({ data: [] } as any);

    const capacity = await getActivePortfolioCapacity({
      supabase: supabase as any,
      userId,
    });

    const rawRows = (rows ?? []) as ScanRow[];
    let entryValidatedRows = rawRows;
    if (dateUsed && rawRows.length > 0) {
      const symbols = Array.from(new Set(rawRows.map((r) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean)));
      const { data: barsOnDate } = await (supabase as any)
        .from("price_bars")
        .select("symbol,close,date")
        .eq("date", dateUsed)
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
        reason_summary: row.reason_summary ?? null,
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
        date_used: dateUsed ?? null,
        lctd: lctd.lctd,
        lctd_source: lctd.source,
        regime_state: regimeState,
        regime_date: regimeDate,
        regime_stale: regimeStale,
        breadth_state: breadth.breadthState,
        breadth_label: breadth.breadthLabel,
        pct_above_sma50: breadth.pctAboveSma50,
        pct_above_sma200: breadth.pctAboveSma200,
        breadth_sample_size: breadth.sampleSize,
      },
      capacity,
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
    const strategyVersion = String(url.searchParams.get("strategy_version") ?? DEFAULT_STRATEGY).trim() || DEFAULT_STRATEGY;
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
