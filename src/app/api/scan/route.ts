import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CORE_MOMENTUM_BUY_CAP,
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
  CORE_MOMENTUM_WATCH_CAP,
  evaluateCoreMomentumSwing,
  isoDate,
  type RegimeState,
  type RuleEvaluation,
} from "@/lib/strategy/coreMomentumSwing";
import {
  TREND_HOLD_BUY_CAP,
  TREND_HOLD_DEFAULT_VERSION,
  TREND_HOLD_WATCH_CAP,
  evaluateTrendHold,
} from "@/lib/strategy/trendHold";
import { lastCompletedUsTradingDay } from "@/lib/tradingDay";

type ScanBody = {
  universe_slug?: string;
  version?: string;
  strategy_version?: string;
  offset?: number;
  limit?: number;
  scan_date?: string;
};

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i += 1) sum += values[i];
  return sum / period;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars for admin client");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getRegimeByDate(opts: {
  supabase: ReturnType<typeof admin>;
  scanDate: string;
}) {
  const { supabase, scanDate } = opts;

  const { data: exactData, error: exactErr } = await supabase
    .from("market_regime")
    .select("date,state")
    .eq("symbol", "SPY")
    .eq("date", scanDate)
    .limit(1);
  if (exactErr) throw exactErr;

  const exact = exactData?.[0];
  if (exact?.state) {
    return {
      regimeState: (exact.state as RegimeState) ?? "FAVORABLE",
      regimeDateUsed: String(exact.date),
      regimeStale: String(exact.date) !== scanDate,
    };
  }

  const { data: latestRegimeData, error: latestRegimeErr } = await supabase
    .from("market_regime")
    .select("date,state")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);

  if (latestRegimeErr) throw latestRegimeErr;
  const latestRegime = latestRegimeData?.[0];
  if (latestRegime?.state) {
    return {
      regimeState: (latestRegime.state as RegimeState) ?? "FAVORABLE",
      regimeDateUsed: String(latestRegime.date),
      regimeStale: String(latestRegime.date) !== scanDate,
    };
  }

  const { data: spyBars, error: spyErr } = await supabase
    .from("price_bars")
    .select("date,close")
    .eq("symbol", "SPY")
    .eq("source", "polygon")
    .lte("date", scanDate)
    .order("date", { ascending: false })
    .limit(260);

  if (spyErr) throw spyErr;

  if (spyBars && spyBars.length >= 200) {
    const latestSpyDate = String(spyBars[0]?.date ?? "");
    const asc = [...spyBars].reverse();
    const closes = asc.map((b) => Number(b.close)).filter((x) => Number.isFinite(x));
    if (closes.length >= 200) {
      const sma200Slice = closes.slice(-200);
      const sma200 = sma200Slice.reduce((sum, v) => sum + v, 0) / 200;
      const latestClose = closes[closes.length - 1];
      const regimeState: RegimeState = latestClose > sma200 ? "FAVORABLE" : "DEFENSIVE";
      return {
        regimeState,
        regimeDateUsed: latestSpyDate || scanDate,
        regimeStale: (latestSpyDate || scanDate) !== scanDate,
      };
    }
  }

  return {
    regimeState: "FAVORABLE" as RegimeState,
    regimeDateUsed: scanDate,
    regimeStale: true,
  };
}

async function enforceGlobalCaps(opts: {
  supabase: ReturnType<typeof admin>;
  date: string;
  universe_slug: string;
  strategy_version: string;
  buyCap: number;
  watchCap: number;
}) {
  const { supabase, date, universe_slug, strategy_version, buyCap, watchCap } = opts;

  const { data, error } = await supabase
    .from("daily_scans")
    .select("date,universe_slug,strategy_version,symbol,signal,confidence,reason_summary,reason_json")
    .eq("date", date)
    .eq("universe_slug", universe_slug)
    .eq("strategy_version", strategy_version)
    .in("signal", ["BUY", "WATCH"]);

  if (error) throw error;
  if (!data || data.length === 0) return;

  const byRank = [...data].sort((a, b) => {
    const ac = Number(a.confidence ?? 0);
    const bc = Number(b.confidence ?? 0);
    if (bc !== ac) return bc - ac;
    return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
  });

  const buys = byRank.filter((row) => row.signal === "BUY");
  const watches = byRank.filter((row) => row.signal === "WATCH");

  const keyOf = (row: {
    date: string;
    universe_slug: string;
    strategy_version: string;
    symbol: string;
  }) =>
    `${String(row.date)}|${String(row.universe_slug)}|${String(row.strategy_version)}|${String(row.symbol)}`;

  const keepBuy = new Set(buys.slice(0, buyCap).map((row) => keyOf(row as any)));
  const buyOverflow = buys.slice(buyCap);

  const watchPool = [...watches, ...buyOverflow].sort((a, b) => {
    const ac = Number(a.confidence ?? 0);
    const bc = Number(b.confidence ?? 0);
    if (bc !== ac) return bc - ac;
    return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
  });

  const keepWatch = new Set(watchPool.slice(0, watchCap).map((row) => keyOf(row as any)));

  const updates: Array<{
    date: string;
    universe_slug: string;
    strategy_version: string;
    symbol: string;
    signal: "BUY" | "WATCH" | "AVOID";
    reason_summary: string;
    reason_json: unknown;
    updated_at: string;
  }> = [];

  for (const row of data) {
    const key = keyOf(row as any);
    const shouldBeBuy = keepBuy.has(key);
    const shouldBeWatch = !shouldBeBuy && keepWatch.has(key);
    const desired: "BUY" | "WATCH" | "AVOID" = shouldBeBuy ? "BUY" : shouldBeWatch ? "WATCH" : "AVOID";
    if (row.signal === desired) continue;

    const priorReason = row.reason_json && typeof row.reason_json === "object" ? row.reason_json : {};
    const capAdjustment =
      row.signal === "BUY" && desired === "WATCH"
        ? "BUY overflow downgraded to WATCH (global cap)"
        : row.signal === "WATCH" && desired === "AVOID"
          ? "WATCH overflow downgraded to AVOID (global cap)"
          : row.signal === "BUY" && desired === "AVOID"
            ? "BUY overflow downgraded to AVOID (global cap cascade)"
            : "Signal adjusted by global cap finalizer";

    updates.push({
      date: String((row as any).date),
      universe_slug: String((row as any).universe_slug),
      strategy_version: String((row as any).strategy_version),
      symbol: String((row as any).symbol),
      signal: desired,
      reason_summary: `${String(row.reason_summary ?? "").trim()} • ${capAdjustment}`.trim(),
      reason_json: {
        ...priorReason,
        cap_adjustment: capAdjustment,
        capped_signal: desired,
      },
      updated_at: new Date().toISOString(),
    });
  }

  if (updates.length === 0) return;

  const { error: upErr } = await supabase
    .from("daily_scans")
    .upsert(updates, { onConflict: "date,universe_slug,strategy_version,symbol" });
  if (upErr) throw upErr;
}

export async function POST(req: Request) {
  try {
    const supabase = admin();
    const body = (await req.json().catch(() => ({}))) as ScanBody;

    const universe_slug = body.universe_slug ?? CORE_MOMENTUM_DEFAULT_UNIVERSE;
    const strategyVersion = body.strategy_version ?? body.version ?? CORE_MOMENTUM_DEFAULT_VERSION;
    const isTrend = strategyVersion === TREND_HOLD_DEFAULT_VERSION;
    const buyCap = isTrend ? TREND_HOLD_BUY_CAP : CORE_MOMENTUM_BUY_CAP;
    const watchCap = isTrend ? TREND_HOLD_WATCH_CAP : CORE_MOMENTUM_WATCH_CAP;
    const offset = Number.isFinite(body.offset as number) ? Number(body.offset) : 0;
    const limit = Number.isFinite(body.limit as number) ? Number(body.limit) : 200;
    const scanDate = (body.scan_date && String(body.scan_date)) || isoDate();
    const expectedTradingDate = lastCompletedUsTradingDay();
    const staleScan = scanDate < expectedTradingDate;

    const { regimeState, regimeDateUsed, regimeStale } = await getRegimeByDate({
      supabase,
      scanDate,
    });

    const { data: universe, error: uErr } = await supabase
      .from("universes")
      .select("id,slug")
      .eq("slug", universe_slug)
      .single();
    if (uErr || !universe) {
      return NextResponse.json({ ok: false, error: `Universe not found: ${universe_slug}` }, { status: 400 });
    }

    const { data: members, error: mErr } = await supabase
      .from("universe_members")
      .select("symbol")
      .eq("universe_id", universe.id)
      .eq("active", true)
      .order("symbol", { ascending: true })
      .range(offset, offset + limit - 1);
    if (mErr) throw mErr;

    const symbols = (members ?? []).map((m) => String(m.symbol ?? "").toUpperCase()).filter(Boolean);
    if (symbols.length === 0) {
      await enforceGlobalCaps({
        supabase,
        date: scanDate,
        universe_slug,
        strategy_version: strategyVersion,
        buyCap,
        watchCap,
      });
      return NextResponse.json({
        ok: true,
        universe_slug,
        strategy_version: strategyVersion,
        date: scanDate,
        offset,
        limit,
        processed: 0,
        upserted: 0,
        note: "No symbols in this batch range",
      });
    }

    const upserts: Array<{
      date: string;
      universe_slug: string;
      strategy_version: string;
      symbol: string;
      signal: RuleEvaluation["signal"];
      confidence: number;
      entry: number;
      stop: number;
      tp1: number;
      tp2: number;
      reason_summary: string;
      reason_json: RuleEvaluation["reason_json"];
      updated_at: string;
    }> = [];

    let processed = 0;
    let scored = 0;
    let spy252Return: number | null = null;
    if (isTrend) {
      const { data: spyBars, error: spyErr } = await supabase
        .from("price_bars")
        .select("date,close")
        .eq("symbol", "SPY")
        .eq("source", "polygon")
        .lte("date", scanDate)
        .order("date", { ascending: true })
        .limit(260);
      if (!spyErr && spyBars && spyBars.length >= 252) {
        const latest = Number(spyBars[spyBars.length - 1]?.close);
        const start = Number(spyBars[spyBars.length - 252]?.close);
        if (Number.isFinite(latest) && Number.isFinite(start) && start > 0) {
          spy252Return = latest / start - 1;
        }
      }
    }

    for (const symbol of symbols) {
      processed += 1;

      const { data: bars, error: bErr } = await supabase
        .from("price_bars")
        .select("date,open,high,low,close,volume")
        .eq("symbol", symbol)
        .eq("source", "polygon")
        .lte("date", scanDate)
        .order("date", { ascending: true })
        .limit(300);
      if (bErr || !bars || bars.length < 260) continue;

      const computed = isTrend
        ? evaluateTrendHold({
            bars: bars.map((bar) => ({
              date: String(bar.date),
              open: Number(bar.open),
              high: Number(bar.high),
              low: Number(bar.low),
              close: Number(bar.close),
              volume: Number(bar.volume),
            })),
            regime: regimeState,
            spy252Return,
          })
        : evaluateCoreMomentumSwing({
            bars: bars.map((bar) => ({
              date: String(bar.date),
              open: Number(bar.open),
              high: Number(bar.high),
              low: Number(bar.low),
              close: Number(bar.close),
              volume: Number(bar.volume),
            })),
            regime: regimeState,
          });
      if (!computed) continue;
      scored += 1;

      const reasonJsonWithFlags = {
        ...computed.reason_json,
        flags: {
          ...(((computed.reason_json as any)?.flags ?? {}) as Record<string, unknown>),
          event_risk: false,
          earnings_within_days: null,
          news_risk: false,
        },
        execution_flags: {
          ...(((computed.reason_json as any)?.execution_flags ?? {}) as Record<string, unknown>),
          stale_scan: staleScan,
          scan_date: scanDate,
          last_completed_trading_day: expectedTradingDate,
          price_mismatch: null,
          divergence_pct: null,
        },
      } as RuleEvaluation["reason_json"];

      upserts.push({
        date: scanDate,
        universe_slug,
        strategy_version: strategyVersion,
        symbol,
        signal: computed.signal,
        confidence: computed.confidence,
        entry: computed.entry,
        stop: computed.stop,
        tp1: computed.tp1,
        tp2: computed.tp2,
        reason_summary: computed.reason_summary,
        reason_json: reasonJsonWithFlags,
        updated_at: new Date().toISOString(),
      });
    }

    let upserted = 0;
    if (upserts.length > 0) {
      const { data: sData, error: sErr } = await supabase
        .from("daily_scans")
        .upsert(upserts, { onConflict: "date,universe_slug,strategy_version,symbol" })
        .select("id");
      if (sErr) throw sErr;
      upserted = sData?.length ?? 0;
    }

    await enforceGlobalCaps({
      supabase,
      date: scanDate,
      universe_slug,
      strategy_version: strategyVersion,
      buyCap,
      watchCap,
    });

    return NextResponse.json({
      ok: true,
      universe_slug,
      strategy_version: strategyVersion,
      date: scanDate,
      stale_scan: staleScan,
      last_completed_trading_day: expectedTradingDate,
      regime: regimeState,
      regime_state: regimeState,
      regime_date_used: regimeDateUsed,
      regime_stale: regimeStale,
      offset,
      limit,
      processed,
      scored,
      upserted,
      caps: {
        BUY: buyCap,
        WATCH: watchCap,
      },
    });
  } catch (e: unknown) {
    console.error("scan error", e);
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const stack = e instanceof Error ? e.stack : undefined;

    return NextResponse.json(
      { ok: false, error: message, detail: stack ?? null },
      { status: 500 }
    );
  }
}
