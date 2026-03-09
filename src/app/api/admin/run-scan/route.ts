import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAutopilot } from "@/app/api/jobs/daily-autopilot/route";
import { runPopulate } from "@/app/api/jobs/populate-sector-momentum/route";
import { runScanPipeline } from "@/lib/scan_engine";
import { getLCTD } from "@/lib/scan_date";

export const dynamic = "force-dynamic";

const STRATEGIES = ["v1", "v1_trend_hold", "v1_sector_momentum"] as const;
const UNIVERSES = ["liquid_2000", "core_800", "growth_1500", "midcap_1000"] as const;

type StrategyVersion = (typeof STRATEGIES)[number];
type UniverseSlug = (typeof UNIVERSES)[number];

type StepResult = {
  strategy_version: StrategyVersion;
  universe_slug: UniverseSlug;
  ok: boolean;
  scan_date_used: string;
  before_count: number;
  after_count: number;
  inserted_count: number;
  error?: string | null;
};

function makeServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as any;
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

async function withTimeout<T>(label: string, p: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function runSingle(opts: {
  supabase: any;
  scanDate: string;
  strategy: StrategyVersion;
  universe: UniverseSlug;
}): Promise<StepResult> {
  const before = await countRowsForDate({
    supabase: opts.supabase,
    date: opts.scanDate,
    strategy_version: opts.strategy,
    universe_slug: opts.universe,
  });

  let ok = true;
  let error: string | null = null;

  try {
    if (opts.strategy === "v1_sector_momentum") {
      const res = await withTimeout(
        `sector populate ${opts.universe}`,
        runPopulate({ universe_slug: opts.universe }),
        55_000
      );
      const payload = await (res as Response).json().catch(() => null);
      if (!(res as Response).ok || !payload?.ok) {
        throw new Error(String(payload?.error ?? `sector populate failed for ${opts.universe}`));
      }
    } else {
      const out = await withTimeout(
        `scan pipeline ${opts.strategy}@${opts.universe}`,
        runScanPipeline({
          supabase: opts.supabase,
          universe_slug: opts.universe,
          strategy_version: opts.strategy,
          scan_date: opts.scanDate,
          finalize: true,
        }),
        55_000
      );
      if (!(out as any)?.ok) {
        throw new Error(String((out as any)?.error ?? "scan pipeline failed"));
      }
    }
  } catch (e: any) {
    ok = false;
    error = e?.message ?? "unknown scan error";
  }

  const after = await countRowsForDate({
    supabase: opts.supabase,
    date: opts.scanDate,
    strategy_version: opts.strategy,
    universe_slug: opts.universe,
  });

  return {
    strategy_version: opts.strategy,
    universe_slug: opts.universe,
    ok,
    scan_date_used: opts.scanDate,
    before_count: before,
    after_count: after,
    inserted_count: Math.max(0, after - before),
    error,
  };
}

async function runAll(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: invalid x-admin-key" },
      { status: 401 }
    );
  }

  const supabase = makeServiceClient();
  const resolvedDate = await resolveScanDate(supabase);
  if (!resolvedDate.scan_date) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve scan date from today or LCTD" },
      { status: 500 }
    );
  }

  const scanDate = resolvedDate.scan_date;
  console.info("[admin/run-scan] run-all start", { scanDate, source: resolvedDate.source });

  const runResults: StepResult[] = [];
  for (const strategy of STRATEGIES) {
    for (const universe of UNIVERSES) {
      const result = await runSingle({
        supabase,
        scanDate,
        strategy,
        universe,
      });
      runResults.push(result);
      console.info("[admin/run-scan] step", result);
    }
  }

  const rowsWritten = runResults.reduce((sum, r) => sum + Number(r.inserted_count ?? 0), 0);
  const failed = runResults.filter((r) => !r.ok);

  return NextResponse.json({
    ok: failed.length === 0,
    status: failed.length === 0 ? "scan complete" : "scan complete (with errors)",
    scan_date_used: scanDate,
    scan_date_source: resolvedDate.source,
    strategies_run: [...STRATEGIES],
    universes_run: [...UNIVERSES],
    rows_written: rowsWritten,
    run_results: runResults,
    errors: failed.map((f) => ({
      strategy_version: f.strategy_version,
      universe_slug: f.universe_slug,
      error: f.error ?? "unknown",
    })),
  });
}

async function runSingleFromBody(req: Request, body: any) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: invalid x-admin-key" },
      { status: 401 }
    );
  }

  const strategyRaw = String(body?.strategy_version ?? "").trim();
  const universeRaw = String(body?.universe_slug ?? "").trim();

  if (!isStrategyVersion(strategyRaw) || !isUniverseSlug(universeRaw)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid strategy_version or universe_slug",
        allowed: { strategies: STRATEGIES, universes: UNIVERSES },
      },
      { status: 400 }
    );
  }

  const supabase = makeServiceClient();
  const resolvedDate = await resolveScanDate(supabase);
  if (!resolvedDate.scan_date) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve scan date from today or LCTD" },
      { status: 500 }
    );
  }

  const result = await runSingle({
    supabase,
    scanDate: resolvedDate.scan_date,
    strategy: strategyRaw,
    universe: universeRaw,
  });

  return NextResponse.json({
    ok: result.ok,
    status: result.ok ? "scan complete" : "scan failed",
    scan_date_used: result.scan_date_used,
    strategies_run: [result.strategy_version],
    universes_run: [result.universe_slug],
    rows_written: result.inserted_count,
    run_result: result,
    error: result.error ?? null,
  });
}

async function runRefreshBars(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: invalid x-admin-key" },
      { status: 401 }
    );
  }

  try {
    const autopilot = await withTimeout("daily-autopilot", runAutopilot(), 55_000);
    if (!(autopilot as any)?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "daily-autopilot failed",
          detail: autopilot ?? null,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      status: "bars refreshed",
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
        error: e?.message ?? "daily-autopilot timeout or failure",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const mode = String(body?.mode ?? "all").trim().toLowerCase();

    if (mode === "single") return await runSingleFromBody(req, body);
    if (mode === "refresh_bars") return await runRefreshBars(req);
    return await runAll(req);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    return await runAll(req);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
