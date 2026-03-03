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

type ScanBody = {
  universe_slug?: string;
  version?: string;
  strategy_version?: string;
  offset?: number;
  limit?: number;
  scan_date?: string;
};

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

  const { data, error } = await supabase
    .from("market_regime")
    .select("date,state")
    .eq("symbol", "SPY")
    .lte("date", scanDate)
    .order("date", { ascending: false })
    .limit(1);

  if (error) throw error;
  const state = (data?.[0]?.state as RegimeState | undefined) ?? "CAUTION";
  return state;
}

async function enforceGlobalCaps(opts: {
  supabase: ReturnType<typeof admin>;
  date: string;
  universe_slug: string;
}) {
  const { supabase, date, universe_slug } = opts;

  const { data, error } = await supabase
    .from("daily_scans")
    .select("id,symbol,signal,confidence,reason_summary,reason_json")
    .eq("date", date)
    .eq("universe_slug", universe_slug)
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

  const keepBuy = new Set(buys.slice(0, CORE_MOMENTUM_BUY_CAP).map((row) => row.id));
  const buyOverflow = buys.slice(CORE_MOMENTUM_BUY_CAP);

  const watchPool = [...watches, ...buyOverflow].sort((a, b) => {
    const ac = Number(a.confidence ?? 0);
    const bc = Number(b.confidence ?? 0);
    if (bc !== ac) return bc - ac;
    return String(a.symbol ?? "").localeCompare(String(b.symbol ?? ""));
  });

  const keepWatch = new Set(watchPool.slice(0, CORE_MOMENTUM_WATCH_CAP).map((row) => row.id));

  const updates: Array<{
    id: string;
    signal: "BUY" | "WATCH" | "AVOID";
    reason_summary: string;
    reason_json: unknown;
    updated_at: string;
  }> = [];

  for (const row of data) {
    const shouldBeBuy = keepBuy.has(row.id);
    const shouldBeWatch = !shouldBeBuy && keepWatch.has(row.id);
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
      id: row.id,
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

  const { error: upErr } = await supabase.from("daily_scans").upsert(updates, { onConflict: "id" });
  if (upErr) throw upErr;
}

export async function POST(req: Request) {
  try {
    const supabase = admin();
    const body = (await req.json().catch(() => ({}))) as ScanBody;

    const universe_slug = body.universe_slug ?? CORE_MOMENTUM_DEFAULT_UNIVERSE;
    const strategyVersion = body.strategy_version ?? body.version ?? CORE_MOMENTUM_DEFAULT_VERSION;
    const offset = Number.isFinite(body.offset as number) ? Number(body.offset) : 0;
    const limit = Number.isFinite(body.limit as number) ? Number(body.limit) : 200;
    const scanDate = (body.scan_date && String(body.scan_date)) || isoDate();

    const regime = await getRegimeByDate({ supabase, scanDate });

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
      await enforceGlobalCaps({ supabase, date: scanDate, universe_slug });
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

    for (const symbol of symbols) {
      processed += 1;

      const { data: bars, error: bErr } = await supabase
        .from("price_bars")
        .select("date,open,high,low,close,volume")
        .eq("symbol", symbol)
        .eq("source", "polygon")
        .lte("date", scanDate)
        .order("date", { ascending: true })
        .limit(260);
      if (bErr || !bars || bars.length < 220) continue;

      const computed = evaluateCoreMomentumSwing({
        bars: bars.map((bar) => ({
          date: String(bar.date),
          open: Number(bar.open),
          high: Number(bar.high),
          low: Number(bar.low),
          close: Number(bar.close),
          volume: Number(bar.volume),
        })),
        regime,
      });
      if (!computed) continue;
      scored += 1;

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
        reason_json: computed.reason_json,
        updated_at: new Date().toISOString(),
      });
    }

    let upserted = 0;
    if (upserts.length > 0) {
      const { data: sData, error: sErr } = await supabase
        .from("daily_scans")
        .upsert(upserts, { onConflict: "date,universe_slug,symbol" })
        .select("id");
      if (sErr) throw sErr;
      upserted = sData?.length ?? 0;
    }

    await enforceGlobalCaps({ supabase, date: scanDate, universe_slug });

    return NextResponse.json({
      ok: true,
      universe_slug,
      strategy_version: strategyVersion,
      date: scanDate,
      regime,
      offset,
      limit,
      processed,
      scored,
      upserted,
      caps: {
        BUY: CORE_MOMENTUM_BUY_CAP,
        WATCH: CORE_MOMENTUM_WATCH_CAP,
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
