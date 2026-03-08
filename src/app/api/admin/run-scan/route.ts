import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAutopilot } from "@/app/api/jobs/daily-autopilot/route";
import { runPopulate } from "@/app/api/jobs/populate-sector-momentum/route";
import { CORE_MOMENTUM_DEFAULT_VERSION } from "@/lib/strategy/coreMomentumSwing";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";
import {
  SECTOR_MOMENTUM_STRATEGY_VERSION,
  SECTOR_MOMENTUM_UNIVERSE_SLUG,
} from "@/lib/sector_momentum";
import { CORE_MOMENTUM_DEFAULT_UNIVERSE } from "@/lib/strategy/coreMomentumSwing";
import { runScanPipeline } from "@/lib/scan_engine";
import { getLCTD } from "@/lib/scan_date";
import { MIDCAP_UNIVERSE_SLUG } from "@/lib/strategy_universe";

export const dynamic = "force-dynamic";

type StrategyCount = {
  strategy_version: string;
  universe_slug: string;
  before_count: number;
  after_count: number;
  inserted_count: number;
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

async function runAllStrategies(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: invalid x-admin-key" },
      { status: 401 }
    );
  }

  const supabase = makeServiceClient();
  const lctd = await getLCTD(supabase as any);
  const targetDate = String(lctd?.scan_date ?? "").trim();
  if (!targetDate) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve target scan date" },
      { status: 500 }
    );
  }

  const beforeMomentum = await countRowsForDate({
    supabase,
    date: targetDate,
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
  });
  const beforeTrend = await countRowsForDate({
    supabase,
    date: targetDate,
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
  });
  const beforeSector = await countRowsForDate({
    supabase,
    date: targetDate,
    strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
    universe_slug: SECTOR_MOMENTUM_UNIVERSE_SLUG,
  });
  const beforeMomentumMidcap = await countRowsForDate({
    supabase,
    date: targetDate,
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    universe_slug: MIDCAP_UNIVERSE_SLUG,
  });
  const beforeTrendMidcap = await countRowsForDate({
    supabase,
    date: targetDate,
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    universe_slug: MIDCAP_UNIVERSE_SLUG,
  });

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

  const scanDate = String(autopilot.scan_date_used ?? autopilot.scan_date ?? "").trim();
  if (!scanDate) {
    return NextResponse.json(
      { ok: false, error: "Unable to determine scan_date_used from autopilot result" },
      { status: 500 }
    );
  }

  const sectorRes = await runPopulate();
  const sectorJson = await sectorRes.json().catch(() => null);
  if (!sectorRes.ok || !sectorJson?.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "sector-momentum populate failed",
        detail: sectorJson ?? null,
        scan_date_used: scanDate,
        autopilot,
      },
      { status: 500 }
    );
  }

  const midcapMomentum = await runScanPipeline({
    supabase,
    universe_slug: MIDCAP_UNIVERSE_SLUG,
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    scan_date: scanDate,
    finalize: true,
  });
  if (!midcapMomentum?.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "midcap momentum scan failed",
        detail: midcapMomentum ?? null,
        scan_date_used: scanDate,
        autopilot,
      },
      { status: 500 }
    );
  }

  const midcapTrend = await runScanPipeline({
    supabase,
    universe_slug: MIDCAP_UNIVERSE_SLUG,
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    scan_date: scanDate,
    finalize: true,
  });
  if (!midcapTrend?.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "midcap trend scan failed",
        detail: midcapTrend ?? null,
        scan_date_used: scanDate,
        autopilot,
      },
      { status: 500 }
    );
  }

  const afterMomentum = await countRowsForDate({
    supabase,
    date: scanDate,
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
  });
  const afterTrend = await countRowsForDate({
    supabase,
    date: scanDate,
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
  });
  const afterSector = await countRowsForDate({
    supabase,
    date: scanDate,
    strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
    universe_slug: SECTOR_MOMENTUM_UNIVERSE_SLUG,
  });
  const afterMomentumMidcap = await countRowsForDate({
    supabase,
    date: scanDate,
    strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
    universe_slug: MIDCAP_UNIVERSE_SLUG,
  });
  const afterTrendMidcap = await countRowsForDate({
    supabase,
    date: scanDate,
    strategy_version: TREND_HOLD_DEFAULT_VERSION,
    universe_slug: MIDCAP_UNIVERSE_SLUG,
  });

  const strategy_counts: StrategyCount[] = [
    {
      strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
      universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
      before_count: beforeMomentum,
      after_count: afterMomentum,
      inserted_count: Math.max(0, afterMomentum - beforeMomentum),
    },
    {
      strategy_version: TREND_HOLD_DEFAULT_VERSION,
      universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
      before_count: beforeTrend,
      after_count: afterTrend,
      inserted_count: Math.max(0, afterTrend - beforeTrend),
    },
    {
      strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION,
      universe_slug: SECTOR_MOMENTUM_UNIVERSE_SLUG,
      before_count: beforeSector,
      after_count: afterSector,
      inserted_count: Math.max(0, afterSector - beforeSector),
    },
    {
      strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
      universe_slug: MIDCAP_UNIVERSE_SLUG,
      before_count: beforeMomentumMidcap,
      after_count: afterMomentumMidcap,
      inserted_count: Math.max(0, afterMomentumMidcap - beforeMomentumMidcap),
    },
    {
      strategy_version: TREND_HOLD_DEFAULT_VERSION,
      universe_slug: MIDCAP_UNIVERSE_SLUG,
      before_count: beforeTrendMidcap,
      after_count: afterTrendMidcap,
      inserted_count: Math.max(0, afterTrendMidcap - beforeTrendMidcap),
    },
  ];

  return NextResponse.json({
    ok: true,
    scan_date_used: scanDate,
    strategies_ran: [
      CORE_MOMENTUM_DEFAULT_VERSION,
      TREND_HOLD_DEFAULT_VERSION,
      SECTOR_MOMENTUM_STRATEGY_VERSION,
      `${CORE_MOMENTUM_DEFAULT_VERSION}@${MIDCAP_UNIVERSE_SLUG}`,
      `${TREND_HOLD_DEFAULT_VERSION}@${MIDCAP_UNIVERSE_SLUG}`,
    ],
    strategy_counts,
    autopilot_summary: {
      bars_upserted: autopilot.bars_upserted ?? 0,
      momentum: autopilot.momentum ?? null,
      trend: autopilot.trend ?? null,
      regime_state: autopilot.regime_state ?? null,
    },
    sector_summary: {
      candidates_count: sectorJson.candidates_count ?? 0,
      persisted_rows: sectorJson.persisted_rows ?? 0,
      pruned_rows: sectorJson.pruned_rows ?? 0,
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
