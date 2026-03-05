import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
} from "@/lib/strategy/coreMomentumSwing";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";
import {
  finalizeSignals,
  runScanPipeline,
  type ScanEngineClient,
} from "@/lib/scan_engine";
import { getLCTD } from "@/lib/scan_date";
import { runDiagnosticsWithClient } from "@/lib/diagnostics";

const UNIVERSE_SLUG = "core_800";
const STATUS_KEY = "daily_autopilot_core_800";

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

async function ingestGroupedForDate(opts: {
  supabase: any;
  date: string;
  symbols: string[];
}) {
  const supa = opts.supabase as any;
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("Missing POLYGON_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const groupedUrl = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(
    opts.date
  )}?adjusted=false&apiKey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(groupedUrl, { cache: "no-store", signal: controller.signal }).finally(() =>
    clearTimeout(timeout)
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Polygon grouped fetch failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const json = (await res.json().catch(() => null)) as
    | { results?: Array<Record<string, unknown>> }
    | null;
  const groupedRows = Array.isArray(json?.results) ? json.results : [];

  const symbolSet = new Set(opts.symbols);
  const { data: existingRows, error: existingErr } = await supa
    .from("price_bars")
    .select("symbol")
    .eq("date", opts.date)
    .in("symbol", Array.from(symbolSet))
    .eq("source", "polygon");
  if (existingErr) throw existingErr;
  const alreadyPresent = new Set(
    (existingRows ?? [])
      .map((r: { symbol?: string | null }) => String(r.symbol ?? "").toUpperCase())
      .filter(Boolean)
  );

  const upserts: Array<{
    symbol: string;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source: string;
  }> = [];

  for (const row of groupedRows) {
    const symbol = String(row.T ?? "").toUpperCase();
    if (!symbolSet.has(symbol)) continue;
    if (alreadyPresent.has(symbol)) continue;
    const open = Number(row.o);
    const high = Number(row.h);
    const low = Number(row.l);
    const close = Number(row.c);
    const volume = Number(row.v);
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }
    upserts.push({
      symbol,
      date: opts.date,
      open,
      high,
      low,
      close,
      volume: Math.round(volume),
      source: "polygon",
    });
  }

  if (upserts.length === 0) return 0;
  const chunkSize = 400;
  let written = 0;
  for (let i = 0; i < upserts.length; i += chunkSize) {
    const chunk = upserts.slice(i, i + chunkSize) as any[];
    const { error } = await supa.from("price_bars").upsert(chunk, {
      onConflict: "symbol,date",
    });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

async function updateSpyRegimeForDate(opts: { supabase: any; date: string }) {
  const supa = opts.supabase as any;
  const { data: latestRows, error: latestErr } = await supa
    .from("price_bars")
    .select("date,close")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);
  if (latestErr) throw latestErr;
  const latest = latestRows?.[0];
  if (!latest) throw new Error("No SPY bars available in price_bars");

  const regimeDateUsed = String(latest.date);
  const spyRegimeStale = regimeDateUsed < opts.date;
  const { data: bars, error: barsErr } = await supa
    .from("price_bars")
    .select("date,close")
    .eq("symbol", "SPY")
    .lte("date", regimeDateUsed)
    .order("date", { ascending: false })
    .limit(260);
  if (barsErr) throw barsErr;
  if (!bars || bars.length < 200) throw new Error("Not enough SPY bars to compute regime");

  const asc = [...bars].reverse();
  const closes = asc.map((b: any) => Number(b.close));
  const sma200 = sma(closes, 200);
  if (!sma200) throw new Error("Unable to compute SPY SMA200");
  const close = Number(latest.close);
  const state = close > sma200 ? "FAVORABLE" : "DEFENSIVE";

  const { error: upErr } = await supa.from("market_regime").upsert(
    {
      symbol: "SPY",
      date: regimeDateUsed,
      close,
      sma200,
      state,
    },
    { onConflict: "symbol,date" }
  );
  if (upErr) throw upErr;

  return { state, regime_date_used: regimeDateUsed, spy_regime_stale: spyRegimeStale };
}

async function runFullStrategyScan(opts: {
  supabase: any;
  universe_slug: string;
  strategy_version: string;
  scan_date_used: string;
  total_members: number;
}) {
  const batchLimit = 200;
  const batches = Math.max(1, Math.ceil(opts.total_members / batchLimit));
  let processed = 0;
  let scored = 0;
  let upserted = 0;
  let regime_state: string | null = null;

  for (let i = 0; i < batches; i += 1) {
    const result = await runScanPipeline({
      supabase: opts.supabase,
      universe_slug: opts.universe_slug,
      strategy_version: opts.strategy_version,
      scan_date: opts.scan_date_used,
      offset: i * batchLimit,
      limit: batchLimit,
      finalize: false,
    });
    if (!result.ok) throw new Error(result.error ?? `Batch ${i + 1} failed`);

    processed += Number(result.processed ?? 0);
    scored += Number(result.scored ?? 0);
    upserted += Number(result.upserted ?? 0);
    regime_state = String(result.regime_state ?? regime_state ?? "FAVORABLE");
    if (Number(result.processed ?? 0) < batchLimit) break;
  }

  const finalization = await finalizeSignals({
    supabase: opts.supabase,
    date: opts.scan_date_used,
    universe_slug: opts.universe_slug,
    strategy_version: opts.strategy_version,
  });
  if (!finalization.ok) throw new Error(finalization.error ?? "Finalization failed");

  return {
    processed,
    scored,
    upserted,
    regime_state,
    finalization,
  };
}

async function writeStatus(payload: Record<string, unknown>) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;
    await supabase.from("system_status").upsert(
      {
        key: STATUS_KEY,
        value: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
  } catch (e) {
    console.error("daily-autopilot status write failed", e);
  }
}

async function runAutopilot() {
  const startedAt = Date.now();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as ScanEngineClient;
  const supa = supabase as any;

  const lctd = await getLCTD(supa);
  if (!lctd.ok || !lctd.scan_date) {
    throw new Error(lctd.error ?? "Unable to resolve scan date");
  }
  const scanDate = lctd.scan_date;

  const { data: universe, error: universeErr } = await supa
    .from("universes")
    .select("id")
    .eq("slug", UNIVERSE_SLUG)
    .maybeSingle();
  if (universeErr) throw new Error(universeErr.message);
  if (!universe?.id) throw new Error(`Universe not found: ${UNIVERSE_SLUG}`);

  const { data: members, error: membersErr } = await supa
    .from("universe_members")
    .select("symbol")
    .eq("universe_id", universe.id)
    .eq("active", true)
    .order("symbol", { ascending: true });
  if (membersErr) throw new Error(membersErr.message);
  const symbols = (members ?? [])
    .map((m: { symbol?: string | null }) => String(m.symbol ?? "").toUpperCase())
    .filter(Boolean);
  const symbolsWithSpy = Array.from(new Set([...symbols, "SPY"]));

  const bars_upserted = await ingestGroupedForDate({
    supabase: supa,
    date: scanDate,
    symbols: symbolsWithSpy,
  });
  const regime = await updateSpyRegimeForDate({ supabase: supa, date: scanDate });

  const momentumRun = await runFullStrategyScan({
    supabase: supa,
    universe_slug: UNIVERSE_SLUG,
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    scan_date_used: scanDate,
    total_members: symbols.length,
  });

  const trendRun = await runFullStrategyScan({
    supabase: supa,
    universe_slug: UNIVERSE_SLUG,
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    scan_date_used: scanDate,
    total_members: symbols.length,
  });

  const diagnostics = await runDiagnosticsWithClient(supa);
  const diagnostics_summary = {
    ok: diagnostics.ok,
    lctd_vs_scans_ok: diagnostics.checks.lctd_vs_scans.ok,
    caps_ok: diagnostics.checks.caps.ok,
  };
  if (!diagnostics_summary.lctd_vs_scans_ok || !diagnostics_summary.caps_ok) {
    throw new Error(`Autopilot diagnostics failed: ${JSON.stringify(diagnostics_summary)}`);
  }

  return {
    ok: true,
    scan_date: scanDate,
    scan_date_used: scanDate,
    lctd_source: lctd.lctd_source,
    bars_upserted,
    regime_state: regime.state,
    regime_date_used: regime.regime_date_used,
    spy_regime_stale: regime.spy_regime_stale,
    momentum: {
      buys: Number((momentumRun.finalization as any)?.buy_count ?? 0),
      watch: Number((momentumRun.finalization as any)?.watch_count ?? 0),
    },
    trend: {
      buys: Number((trendRun.finalization as any)?.buy_count ?? 0),
      watch: Number((trendRun.finalization as any)?.watch_count ?? 0),
    },
    diagnostics_summary,
    duration_ms: Date.now() - startedAt,
  };
}

export async function GET() {
  try {
    const result = await runAutopilot();
    await writeStatus({
      ok: true,
      scan_date: result.scan_date,
      date_used: result.scan_date_used,
      bars_upserted: result.bars_upserted,
      regime_state: result.regime_state,
      regime_date_used: result.regime_date_used,
      spy_regime_stale: result.spy_regime_stale,
      buy_count: result.momentum.buys,
      watch_count: result.momentum.watch,
      trend_buy_count: result.trend.buys,
      trend_watch_count: result.trend.watch,
      diagnostics_summary: result.diagnostics_summary,
      duration_ms: result.duration_ms,
      error: null,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error("daily-autopilot error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    await writeStatus({
      ok: false,
      scan_date: null,
      date_used: null,
      bars_upserted: 0,
      buy_count: 0,
      watch_count: 0,
      trend_buy_count: 0,
      trend_watch_count: 0,
      duration_ms: 0,
      error,
    });
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
