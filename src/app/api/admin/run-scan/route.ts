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

const STRATEGY_UNIVERSES: Record<StrategyVersion, UniverseSlug[]> = {
  v1: ["liquid_2000", "midcap_1000"],
  v1_trend_hold: ["core_800", "liquid_2000"],
  v1_sector_momentum: ["growth_1500", "midcap_1000"],
};

type StepResult = {
  strategy_version: StrategyVersion;
  universe_slug: UniverseSlug;
  ok: boolean;
  timed_out: boolean;
  scan_date_used: string;
  before_count: number;
  after_count: number;
  inserted_count: number;
  duration_ms: number;
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
  timeoutMs?: number;
}): Promise<StepResult> {
  const before = await countRowsForDate({
    supabase: opts.supabase,
    date: opts.scanDate,
    strategy_version: opts.strategy,
    universe_slug: opts.universe,
  });

  const startedAt = Date.now();
  let ok = true;
  let timedOut = false;
  let error: string | null = null;

  try {
    if (opts.strategy === "v1_sector_momentum") {
      const res = await withTimeout(
        `sector populate ${opts.universe}`,
        runPopulate({ universe_slug: opts.universe }),
        opts.timeoutMs ?? 55_000
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
        opts.timeoutMs ?? 55_000
      );
      if (!(out as any)?.ok) {
        throw new Error(String((out as any)?.error ?? "scan pipeline failed"));
      }
    }
  } catch (e: any) {
    ok = false;
    const msg = e?.message ?? "unknown scan error";
    timedOut = /timed out/i.test(String(msg));
    error = msg;
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
    timed_out: timedOut,
    scan_date_used: opts.scanDate,
    before_count: before,
    after_count: after,
    inserted_count: Math.max(0, after - before),
    duration_ms: Date.now() - startedAt,
    error,
  };
}

async function runPlan(opts: {
  req: Request;
  supabase: any;
  scanDate: string;
  strategies: StrategyVersion[];
  explicitUniverse?: UniverseSlug | null;
}) {
  const runResults: StepResult[] = [];

  for (const strategy of opts.strategies) {
    const universes = opts.explicitUniverse ? [opts.explicitUniverse] : STRATEGY_UNIVERSES[strategy];
    for (const universe of universes) {
      if (!STRATEGY_UNIVERSES[strategy].includes(universe)) {
        continue;
      }
      const result = await runSingle({
        supabase: opts.supabase,
        scanDate: opts.scanDate,
        strategy,
        universe,
      });
      runResults.push(result);
      console.info("[admin/run-scan] step", result);
      if (!result.ok) {
        return {
          ok: false,
          runResults,
          failedStep: result,
        };
      }
    }
  }

  return {
    ok: true,
    runResults,
    failedStep: null as StepResult | null,
  };
}

async function runRefreshBars(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: invalid x-admin-key" },
      { status: 401 }
    );
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

async function runByMode(req: Request, body: any) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: invalid x-admin-key" },
      { status: 401 }
    );
  }

  const mode = String(body?.mode ?? "strategy").trim().toLowerCase();
  if (mode === "refresh_bars") return await runRefreshBars(req);

  const supabase = makeServiceClient();
  const resolvedDate = await resolveScanDate(supabase);
  if (!resolvedDate.scan_date) {
    return NextResponse.json(
      { ok: false, status: "scan failed", error: "Unable to resolve scan date from today or LCTD" },
      { status: 500 }
    );
  }
  const scanDate = resolvedDate.scan_date;

  let strategies: StrategyVersion[] = [];
  let explicitUniverse: UniverseSlug | null = null;

  if (mode === "single") {
    const strategyRaw = String(body?.strategy_version ?? "").trim();
    const universeRaw = String(body?.universe_slug ?? "").trim();
    if (!isStrategyVersion(strategyRaw) || !isUniverseSlug(universeRaw)) {
      return NextResponse.json(
        {
          ok: false,
          status: "scan failed",
          error: "Invalid strategy_version or universe_slug",
          allowed: { strategies: STRATEGIES, universes: UNIVERSES },
        },
        { status: 400 }
      );
    }
    if (!STRATEGY_UNIVERSES[strategyRaw].includes(universeRaw)) {
      return NextResponse.json(
        {
          ok: false,
          status: "scan failed",
          error: `Universe ${universeRaw} not allowed for strategy ${strategyRaw}`,
          allowed_universes: STRATEGY_UNIVERSES[strategyRaw],
        },
        { status: 400 }
      );
    }
    strategies = [strategyRaw];
    explicitUniverse = universeRaw;
  } else if (mode === "strategy") {
    const strategyRaw = String(body?.strategy_version ?? "").trim();
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
    strategies = [strategyRaw];
    explicitUniverse = null;
  } else {
    // Deprecated all-in-one path.
    strategies = [...STRATEGIES];
    explicitUniverse = null;
  }

  const startedAt = Date.now();
  const plan = await runPlan({
    req,
    supabase,
    scanDate,
    strategies,
    explicitUniverse,
  });

  const rowsWritten = plan.runResults.reduce((sum, r) => sum + Number(r.inserted_count ?? 0), 0);
  const completedSteps = plan.runResults.length;
  const totalSteps = strategies.reduce((sum, s) => {
    const universeCount = explicitUniverse ? 1 : STRATEGY_UNIVERSES[s].length;
    return sum + universeCount;
  }, 0);

  return NextResponse.json(
    {
      ok: plan.ok,
      status: plan.ok ? "scan complete" : "scan failed",
      scan_date_used: scanDate,
      scan_date_source: resolvedDate.source,
      mode,
      strategy: strategies.length === 1 ? strategies[0] : null,
      universe: explicitUniverse,
      strategies_run: strategies,
      universes_run: explicitUniverse
        ? [explicitUniverse]
        : Array.from(new Set(strategies.flatMap((s) => STRATEGY_UNIVERSES[s]))),
      rows_written: rowsWritten,
      duration_ms: Date.now() - startedAt,
      completed_steps: completedSteps,
      total_steps: totalSteps,
      failed_step: plan.failedStep,
      run_results: plan.runResults,
      error: plan.failedStep?.error ?? null,
    },
    { status: plan.ok ? 200 : 500 }
  );
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
    const mode = String(url.searchParams.get("mode") ?? "").trim().toLowerCase() || "strategy";
    const strategy_version = String(url.searchParams.get("strategy") ?? url.searchParams.get("strategy_version") ?? "").trim();
    const universe_slug = String(url.searchParams.get("universe") ?? url.searchParams.get("universe_slug") ?? "").trim();
    return await runByMode(req, {
      mode,
      strategy_version,
      universe_slug,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, status: "scan failed", error }, { status: 500 });
  }
}
