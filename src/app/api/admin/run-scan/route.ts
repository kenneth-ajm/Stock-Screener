import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAutopilot } from "@/app/api/jobs/daily-autopilot/route";
import { runPopulate } from "@/app/api/jobs/populate-sector-momentum/route";
import { runScanPipeline } from "@/lib/scan_engine";
import { getLCTD } from "@/lib/scan_date";

export const dynamic = "force-dynamic";

const STRATEGIES = ["v1", "v1_trend_hold", "v1_sector_momentum"] as const;
const UNIVERSES = ["liquid_2000", "core_800", "growth_1500", "midcap_1000"] as const;

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
  strategy_version: string;
  universe_slug: string;
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
  const { data: hasSpyToday } = await supabase
    .from("price_bars")
    .select("symbol")
    .eq("symbol", "SPY")
    .eq("date", preferredToday)
    .limit(1)
    .maybeSingle();

  if (hasSpyToday) {
    return { scan_date: preferredToday, source: "today" as const };
  }

  const lctd = await getLCTD(supabase as any);
  const fallback = String(lctd?.scan_date ?? "").trim();
  if (fallback) {
    return { scan_date: fallback, source: "lctd" as const };
  }

  return { scan_date: null, source: "missing" as const };
}

async function runAllStrategies(req: Request) {
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

  const beforeCounts = new Map<string, number>();
  for (const strategy of STRATEGIES) {
    for (const universe of UNIVERSES) {
      const key = `${strategy}::${universe}`;
      const before = await countRowsForDate({
        supabase,
        date: scanDate,
        strategy_version: strategy,
        universe_slug: universe,
      });
      beforeCounts.set(key, before);
    }
  }

  // Keep existing pre-scan refresh behavior.
  const autopilot = await runAutopilot();
  if (!autopilot?.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "daily-autopilot failed",
        detail: autopilot ?? null,
      },
      { status: 500 }
    );
  }

  const runResults: Array<{
    strategy_version: string;
    universe_slug: string;
    ok: boolean;
    error?: string | null;
  }> = [];

  for (const strategy of STRATEGIES) {
    for (const universe of UNIVERSES) {
      if (strategy === "v1_sector_momentum") {
        const res = await runPopulate({ universe_slug: universe });
        const payload = await res.json().catch(() => null);
        runResults.push({
          strategy_version: strategy,
          universe_slug: universe,
          ok: Boolean(res.ok && payload?.ok),
          error: res.ok && payload?.ok ? null : String(payload?.error ?? "sector populate failed"),
        });
        continue;
      }

      const out = await runScanPipeline({
        supabase,
        universe_slug: universe,
        strategy_version: strategy,
        scan_date: scanDate,
        finalize: true,
      });

      runResults.push({
        strategy_version: strategy,
        universe_slug: universe,
        ok: Boolean(out?.ok),
        error: out?.ok ? null : String(out?.error ?? "scan pipeline failed"),
      });
    }
  }

  const failed = runResults.filter((r) => !r.ok);

  const counts = [] as Array<{
    strategy_version: string;
    universe_slug: string;
    before_count: number;
    after_count: number;
    inserted_count: number;
  }>;

  let rowsWritten = 0;
  for (const strategy of STRATEGIES) {
    for (const universe of UNIVERSES) {
      const key = `${strategy}::${universe}`;
      const before = Number(beforeCounts.get(key) ?? 0);
      const after = await countRowsForDate({
        supabase,
        date: scanDate,
        strategy_version: strategy,
        universe_slug: universe,
      });
      const inserted = Math.max(0, after - before);
      rowsWritten += inserted;
      counts.push({
        strategy_version: strategy,
        universe_slug: universe,
        before_count: before,
        after_count: after,
        inserted_count: inserted,
      });
    }
  }

  const status = failed.length === 0 ? "scan complete" : "scan complete (with errors)";

  return NextResponse.json({
    ok: failed.length === 0,
    status,
    scan_date_used: scanDate,
    scan_date_source: resolvedDate.source,
    strategies_run: [...STRATEGIES],
    universes_run: [...UNIVERSES],
    rows_written: rowsWritten,
    strategy_counts: counts,
    run_results: runResults,
    autopilot_summary: {
      bars_upserted: autopilot.bars_upserted ?? 0,
      momentum: autopilot.momentum ?? null,
      trend: autopilot.trend ?? null,
      regime_state: autopilot.regime_state ?? null,
    },
  });
}

export async function POST(req: Request) {
  try {
    return await runAllStrategies(req);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    return await runAllStrategies(req);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
