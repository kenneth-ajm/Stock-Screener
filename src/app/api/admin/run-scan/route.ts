import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAutopilot } from "@/app/api/jobs/daily-autopilot/route";
import { runPopulate } from "@/app/api/jobs/populate-sector-momentum/route";
import { runScanPipeline } from "@/lib/scan_engine";
import { getLCTD } from "@/lib/scan_date";
import { finalizeSignals } from "@/lib/finalize_signals";

export const dynamic = "force-dynamic";

const STRATEGIES = ["v1", "v1_trend_hold", "v1_sector_momentum"] as const;
const UNIVERSES = ["liquid_2000", "core_800", "growth_1500", "midcap_1000"] as const;

type StrategyVersion = (typeof STRATEGIES)[number];
type UniverseSlug = (typeof UNIVERSES)[number];

const STRATEGY_UNIVERSES: Record<StrategyVersion, UniverseSlug[]> = {
  v1: ["liquid_2000", "midcap_1000"],
  v1_trend_hold: ["core_800", "liquid_2000"],
  v1_sector_momentum: ["growth_1500", "midcap_1000"],
};

function makeServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as any;
}

function nowIso() {
  return new Date().toISOString();
}

function makeRequestId() {
  return `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAuthorized(req: Request) {
  const expected = process.env.ADMIN_RUN_SCAN_KEY;
  if (!expected) return true;
  const provided = req.headers.get("x-admin-key");
  return Boolean(provided && provided === expected);
}

function isStrategyVersion(v: string): v is StrategyVersion {
  return (STRATEGIES as readonly string[]).includes(v);
}

function isUniverseSlug(v: string): v is UniverseSlug {
  return (UNIVERSES as readonly string[]).includes(v);
}

function usTodayDate() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function withTimeout<T>(label: string, p: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function countRowsForDate(opts: {
  supabase: any;
  date: string;
  strategy_version: StrategyVersion;
  universe_slug: UniverseSlug;
}) {
  const { count, error } = await opts.supabase
    .from("daily_scans")
    .select("id", { head: true, count: "exact" })
    .eq("date", opts.date)
    .eq("strategy_version", opts.strategy_version)
    .eq("universe_slug", opts.universe_slug);
  if (error) throw error;
  return Number(count ?? 0);
}

async function countUniverseSymbols(opts: {
  supabase: any;
  universe_slug: UniverseSlug;
}) {
  const { data: universe, error: uErr } = await opts.supabase
    .from("universes")
    .select("id")
    .eq("slug", opts.universe_slug)
    .single();
  if (uErr || !universe?.id) {
    throw new Error(`Universe not found: ${opts.universe_slug}`);
  }
  const { count, error } = await opts.supabase
    .from("universe_members")
    .select("symbol", { head: true, count: "exact" })
    .eq("universe_id", universe.id)
    .eq("active", true);
  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

async function resolveScanDate(supabase: any) {
  const preferredToday = usTodayDate();
  const { data: hasSpyToday, error: spyTodayError } = await supabase
    .from("price_bars")
    .select("symbol")
    .eq("symbol", "SPY")
    .eq("date", preferredToday)
    .limit(1)
    .maybeSingle();
  if (spyTodayError) {
    throw new Error(`resolveScanDate(today): ${spyTodayError.message}`);
  }
  if (hasSpyToday) {
    return { scan_date: preferredToday, source: "today" as const };
  }

  const lctd = await getLCTD(supabase as any);
  const fallback = String(lctd?.scan_date ?? "").trim();
  if (fallback) {
    return { scan_date: fallback, source: "lctd" as const };
  }

  const { data: latestSpyBar, error: latestSpyError } = await supabase
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestSpyError) {
    throw new Error(`resolveScanDate(latest_spy_bar): ${latestSpyError.message}`);
  }
  const latestSpyDate = String(latestSpyBar?.date ?? "").trim();
  if (latestSpyDate) {
    return { scan_date: latestSpyDate, source: "latest_spy_bar" as const };
  }

  return { scan_date: null, source: "missing" as const };
}

async function runRefreshBars(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, status: "scan failed", error: "Unauthorized: invalid x-admin-key" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const autopilot = await withTimeout("daily-autopilot", runAutopilot(), 55_000);
    if (!(autopilot as any)?.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: "scan failed",
          duration_ms: Date.now() - startedAt,
          error: "daily-autopilot failed",
          detail: autopilot ?? null,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      status: "bars refreshed",
      duration_ms: Date.now() - startedAt,
      scan_date_used: String((autopilot as any)?.scan_date_used ?? (autopilot as any)?.scan_date ?? "") || null,
      autopilot_summary: {
        bars_upserted: (autopilot as any)?.bars_upserted ?? 0,
        momentum: (autopilot as any)?.momentum ?? null,
        trend: (autopilot as any)?.trend ?? null,
        regime_state: (autopilot as any)?.regime_state ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        status: "scan failed",
        duration_ms: Date.now() - startedAt,
        error: e?.message ?? "daily-autopilot timeout or failure",
      },
      { status: 500 }
    );
  }
}

async function runSectorSingle(opts: {
  supabase: any;
  strategy: StrategyVersion;
  universe: UniverseSlug;
  scanDate: string;
  timeoutMs?: number;
}) {
  const startedAt = Date.now();
  const before = await countRowsForDate({
    supabase: opts.supabase,
    date: opts.scanDate,
    strategy_version: opts.strategy,
    universe_slug: opts.universe,
  });

  try {
    const res = await withTimeout(
      `sector populate ${opts.universe}`,
      runPopulate({ universe_slug: opts.universe }),
      opts.timeoutMs ?? 55_000
    );
    const payload = await (res as Response).json().catch(() => null);
    if (!(res as Response).ok || !payload?.ok) {
      throw new Error(String(payload?.error ?? `sector populate failed for ${opts.universe}`));
    }

    const after = await countRowsForDate({
      supabase: opts.supabase,
      date: opts.scanDate,
      strategy_version: opts.strategy,
      universe_slug: opts.universe,
    });

    return {
      ok: true,
      status: "scan complete",
      strategy: opts.strategy,
      universe: opts.universe,
      scan_date_used: opts.scanDate,
      rows_written: Math.max(0, after - before),
      duration_ms: Date.now() - startedAt,
      before_count: before,
      after_count: after,
      batch_index: 1,
      total_batches: 1,
      has_more: false,
      next_offset: null,
      completed_steps: 1,
      total_steps: 1,
      failed_step: null,
      error: null,
    };
  } catch (e: any) {
    const msg = e?.message ?? "sector scan failed";
    return {
      ok: false,
      status: "scan failed",
      strategy: opts.strategy,
      universe: opts.universe,
      scan_date_used: opts.scanDate,
      rows_written: 0,
      duration_ms: Date.now() - startedAt,
      before_count: before,
      after_count: before,
      batch_index: 1,
      total_batches: 1,
      has_more: false,
      next_offset: null,
      completed_steps: 0,
      total_steps: 1,
      failed_step: {
        strategy_version: opts.strategy,
        universe_slug: opts.universe,
        batch_index: 1,
        error: msg,
      },
      error: msg,
    };
  }
}

async function runChunkedBatch(opts: {
  supabase: any;
  strategy: StrategyVersion;
  universe: UniverseSlug;
  scanDate: string;
  offset: number;
  batchSize: number;
  timeoutMs?: number;
}) {
  const startedAt = Date.now();

  if (opts.strategy === "v1_sector_momentum") {
    const sectorResult = await runSectorSingle({
      supabase: opts.supabase,
      strategy: opts.strategy,
      universe: opts.universe,
      scanDate: opts.scanDate,
      timeoutMs: opts.timeoutMs,
    });
    return sectorResult;
  }

  const totalSymbols = await countUniverseSymbols({
    supabase: opts.supabase,
    universe_slug: opts.universe,
  });
  const totalBatches = Math.max(1, Math.ceil(totalSymbols / opts.batchSize));
  const batchIndex = Math.floor(opts.offset / opts.batchSize) + 1;

  const before = await countRowsForDate({
    supabase: opts.supabase,
    date: opts.scanDate,
    strategy_version: opts.strategy,
    universe_slug: opts.universe,
  });

  try {
    const out = await withTimeout(
      `scan pipeline ${opts.strategy}@${opts.universe} batch ${batchIndex}/${totalBatches}`,
      runScanPipeline({
        supabase: opts.supabase,
        universe_slug: opts.universe,
        strategy_version: opts.strategy,
        scan_date: opts.scanDate,
        offset: opts.offset,
        limit: opts.batchSize,
        finalize: false,
      }),
      opts.timeoutMs ?? 55_000
    );

    if (!(out as any)?.ok) {
      throw new Error(String((out as any)?.error ?? "scan pipeline failed"));
    }

    const after = await countRowsForDate({
      supabase: opts.supabase,
      date: opts.scanDate,
      strategy_version: opts.strategy,
      universe_slug: opts.universe,
    });

    const nextOffset = opts.offset + opts.batchSize;
    const hasMore = nextOffset < totalSymbols;

    return {
      ok: true,
      status: "scan complete",
      strategy: opts.strategy,
      universe: opts.universe,
      scan_date_used: opts.scanDate,
      rows_written: Math.max(0, after - before),
      duration_ms: Date.now() - startedAt,
      before_count: before,
      after_count: after,
      batch_index: batchIndex,
      total_batches: totalBatches,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
      completed_steps: batchIndex,
      total_steps: totalBatches,
      failed_step: null,
      error: null,
    };
  } catch (e: any) {
    const msg = e?.message ?? "scan batch failed";
    return {
      ok: false,
      status: "scan failed",
      strategy: opts.strategy,
      universe: opts.universe,
      scan_date_used: opts.scanDate,
      rows_written: 0,
      duration_ms: Date.now() - startedAt,
      before_count: before,
      after_count: before,
      batch_index: batchIndex,
      total_batches: totalBatches,
      has_more: false,
      next_offset: null,
      completed_steps: Math.max(0, batchIndex - 1),
      total_steps: totalBatches,
      failed_step: {
        strategy_version: opts.strategy,
        universe_slug: opts.universe,
        batch_index: batchIndex,
        error: msg,
      },
      error: msg,
    };
  }
}

async function runFinalize(opts: {
  supabase: any;
  strategy: StrategyVersion;
  universe: UniverseSlug;
  scanDate: string;
}) {
  const startedAt = Date.now();
  try {
    if (opts.strategy === "v1_sector_momentum") {
      return {
        ok: true,
        status: "scan complete",
        strategy: opts.strategy,
        universe: opts.universe,
        scan_date_used: opts.scanDate,
        rows_written: 0,
        duration_ms: Date.now() - startedAt,
        finalization: { skipped: true, reason: "sector_momentum_uses_populate" },
        error: null,
      };
    }

    const before = await countRowsForDate({
      supabase: opts.supabase,
      date: opts.scanDate,
      strategy_version: opts.strategy,
      universe_slug: opts.universe,
    });

    const finalization = await withTimeout(
      `finalize ${opts.strategy}@${opts.universe}`,
      finalizeSignals({
        supabase: opts.supabase,
        date: opts.scanDate,
        universe_slug: opts.universe,
        strategy_version: opts.strategy,
      }),
      55_000
    );

    const after = await countRowsForDate({
      supabase: opts.supabase,
      date: opts.scanDate,
      strategy_version: opts.strategy,
      universe_slug: opts.universe,
    });

    return {
      ok: true,
      status: "scan complete",
      strategy: opts.strategy,
      universe: opts.universe,
      scan_date_used: opts.scanDate,
      rows_written: Math.max(0, after - before),
      duration_ms: Date.now() - startedAt,
      finalization,
      error: null,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: "scan failed",
      strategy: opts.strategy,
      universe: opts.universe,
      scan_date_used: opts.scanDate,
      rows_written: 0,
      duration_ms: Date.now() - startedAt,
      finalization: null,
      error: e?.message ?? "finalize failed",
    };
  }
}

async function runByMode(req: Request, body: any) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, status: "scan failed", error: "Unauthorized: invalid x-admin-key" }, { status: 401 });
  }

  const mode = String(body?.mode ?? "strategy").trim().toLowerCase();
  const requestId = String(body?.request_id ?? "").trim() || makeRequestId();
  if (mode === "refresh_bars") return await runRefreshBars(req);

  const strategyRaw = String(body?.strategy ?? body?.strategy_version ?? "").trim();
  const universeRaw = String(body?.universe ?? body?.universe_slug ?? "").trim();

  if (!isStrategyVersion(strategyRaw)) {
    return NextResponse.json(
      {
        ok: false,
        status: "scan failed",
        error: "Invalid strategy_version",
        allowed: { strategies: STRATEGIES },
      },
      { status: 400 }
    );
  }

  const strategy = strategyRaw;
  const scanStartedAt = nowIso();
  console.info("[admin/run-scan] request:start", {
    request_id: requestId,
    mode,
    strategy_requested: strategyRaw || null,
    universe_requested: universeRaw || null,
    started_at: scanStartedAt,
  });

  if (mode === "strategy") {
    return NextResponse.json({
      ok: false,
      status: "scan failed",
      request_id: requestId,
      error: "mode=strategy is deprecated for long-running scans; use mode=batch + mode=finalize",
      strategy,
      allowed_universes: STRATEGY_UNIVERSES[strategy],
    }, { status: 400 });
  }

  if (!isUniverseSlug(universeRaw)) {
    return NextResponse.json(
      {
        ok: false,
        status: "scan failed",
        error: "Invalid universe_slug",
        allowed: { universes: UNIVERSES },
      },
      { status: 400 }
    );
  }

  const universe = universeRaw;
  if (!STRATEGY_UNIVERSES[strategy].includes(universe)) {
    return NextResponse.json(
      {
        ok: false,
        status: "scan failed",
        request_id: requestId,
        error: `Universe ${universe} not allowed for strategy ${strategy}`,
        strategy,
        allowed_universes: STRATEGY_UNIVERSES[strategy],
      },
      { status: 400 }
    );
  }

  const supabase = makeServiceClient();
  const resolvedDate = await resolveScanDate(supabase);
  if (!resolvedDate.scan_date) {
    return NextResponse.json(
      {
        ok: false,
        status: "scan failed",
        error: "Unable to resolve scan date from today or LCTD",
      },
      { status: 500 }
    );
  }

  const scanDate = resolvedDate.scan_date;

  if (mode === "single") {
    const single = await runChunkedBatch({
      supabase,
      strategy,
      universe,
      scanDate,
      offset: 0,
      batchSize: 40,
      timeoutMs: 55_000,
    });
    const response = {
      ...single,
      request_id: requestId,
      phase: "single",
      bars_mode: "cached_db_only",
      strategy_requested: strategyRaw,
      strategy_version_resolved: strategy,
      universe_requested: universeRaw,
      universe_resolved: universe,
      scan_started_at: scanStartedAt,
      scan_ended_at: nowIso(),
    };
    console.info("[admin/run-scan] request:end", response);
    return NextResponse.json(response, { status: single.ok ? 200 : 500 });
  }

  if (mode === "batch") {
    const offset = Math.max(0, Number(body?.offset ?? 0) || 0);
    const batchSizeRaw = Number(body?.batch_size ?? 40) || 40;
    const batchSize = Math.min(100, Math.max(20, batchSizeRaw));
    const out = await runChunkedBatch({
      supabase,
      strategy,
      universe,
      scanDate,
      offset,
      batchSize,
      timeoutMs: 55_000,
    });
    const response = {
      ...out,
      request_id: requestId,
      phase: "batch",
      bars_mode: "cached_db_only",
      strategy_requested: strategyRaw,
      strategy_version_resolved: strategy,
      universe_requested: universeRaw,
      universe_resolved: universe,
      scan_started_at: scanStartedAt,
      scan_ended_at: nowIso(),
    };
    console.info("[admin/run-scan] request:end", response);
    return NextResponse.json(response, { status: out.ok ? 200 : 500 });
  }

  if (mode === "finalize") {
    const out = await runFinalize({
      supabase,
      strategy,
      universe,
      scanDate,
    });
    const response = {
      ...out,
      request_id: requestId,
      phase: "finalize",
      bars_mode: "cached_db_only",
      strategy_requested: strategyRaw,
      strategy_version_resolved: strategy,
      universe_requested: universeRaw,
      universe_resolved: universe,
      scan_started_at: scanStartedAt,
      scan_ended_at: nowIso(),
    };
    console.info("[admin/run-scan] request:end", response);
    return NextResponse.json(response, { status: out.ok ? 200 : 500 });
  }

  const unsupported = {
    ok: false,
    status: "scan failed",
    request_id: requestId,
    error: `Unsupported mode: ${mode}`,
    supported_modes: ["refresh_bars", "single", "batch", "finalize"],
    scan_started_at: scanStartedAt,
    scan_ended_at: nowIso(),
  };
  console.info("[admin/run-scan] request:end", unsupported);
  return NextResponse.json(unsupported, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    return await runByMode(req, body);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, status: "scan failed", error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mode = String(url.searchParams.get("mode") ?? "").trim().toLowerCase() || "batch";
    const strategy_version = String(url.searchParams.get("strategy") ?? url.searchParams.get("strategy_version") ?? "").trim();
    const universe_slug = String(url.searchParams.get("universe") ?? url.searchParams.get("universe_slug") ?? "").trim();
    const offset = Number(url.searchParams.get("offset") ?? "0") || 0;
    const batch_size = Number(url.searchParams.get("batch_size") ?? "40") || 40;
    return await runByMode(req, {
      mode,
      strategy_version,
      universe_slug,
      offset,
      batch_size,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, status: "scan failed", error }, { status: 500 });
  }
}
