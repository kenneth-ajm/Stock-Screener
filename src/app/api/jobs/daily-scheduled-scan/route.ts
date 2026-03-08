import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAutopilot } from "@/app/api/jobs/daily-autopilot/route";
import { runPopulate } from "@/app/api/jobs/populate-sector-momentum/route";
import { CORE_MOMENTUM_DEFAULT_UNIVERSE, CORE_MOMENTUM_DEFAULT_VERSION } from "@/lib/strategy/coreMomentumSwing";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";
import { SECTOR_MOMENTUM_STRATEGY_VERSION, SECTOR_MOMENTUM_UNIVERSE_SLUG } from "@/lib/sector_momentum";
import { runScanPipeline } from "@/lib/scan_engine";
import { MIDCAP_UNIVERSE_SLUG } from "@/lib/strategy_universe";
import { computeMarketBreadth } from "@/lib/market_breadth";
import { runDiagnosticsWithClient } from "@/lib/diagnostics";
import { OBS_KEYS, writeObservabilityStatus } from "@/lib/observability";

type StageResult = {
  stage: string;
  ok: boolean;
  duration_ms: number;
  detail?: Record<string, unknown>;
  error?: string;
};

function makeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as any;
}

async function runStage(name: string, fn: () => Promise<Record<string, unknown>>) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    return {
      stage: name,
      ok: true,
      duration_ms: Date.now() - startedAt,
      detail,
    } as StageResult;
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    return {
      stage: name,
      ok: false,
      duration_ms: Date.now() - startedAt,
      error,
    } as StageResult;
  }
}

async function runWorkflow(opts: { dry_run?: boolean }) {
  const startedAt = Date.now();
  const dry_run = opts.dry_run === true;
  const supa = makeClient();

  const stages: StageResult[] = [];
  let scan_date_used: string | null = null;
  let regime_state: string | null = null;
  let regime_stale = false;
  let autopilot: any = null;
  let sector: any = null;

  if (dry_run) {
    stages.push({
      stage: "daily_autopilot",
      ok: true,
      duration_ms: 0,
      detail: {
        skipped: true,
        reason: "dry_run=true",
      },
    });
  } else {
    const stage = await runStage("daily_autopilot", async () => {
      const result = await runAutopilot();
      if (!result?.ok) {
        throw new Error("daily-autopilot failed");
      }
      autopilot = result;
      scan_date_used = String(result.scan_date_used ?? "");
      regime_state = String(result.regime_state ?? "");
      regime_stale = Boolean(result.spy_regime_stale ?? false);
      return {
        scan_date_used,
        lctd_source: result.lctd_source ?? null,
        bars_upserted: result.bars_upserted ?? 0,
        momentum: result.momentum ?? null,
        trend: result.trend ?? null,
      };
    });
    stages.push(stage);
  }

  if (!dry_run && stages.find((s) => s.stage === "daily_autopilot" && !s.ok)) {
    const payload = {
      ok: false,
      dry_run,
      scan_date_used,
      stages,
      duration_ms: Date.now() - startedAt,
    };
    await writeObservabilityStatus({
      supabase: supa,
      key: OBS_KEYS.scheduler,
      value: payload,
    }).catch(() => null);
    return payload;
  }

  if (dry_run) {
    stages.push({
      stage: "sector_momentum_scan",
      ok: true,
      duration_ms: 0,
      detail: {
        skipped: true,
        reason: "dry_run=true",
      },
    });
  } else {
    const stage = await runStage("sector_momentum_scan", async () => {
      const res = await runPopulate();
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.error ?? "sector populate failed"));
      }
      sector = json;
      return {
        scan_date_used: json.scan_date_used ?? null,
        strategy_version: json.strategy_version ?? SECTOR_MOMENTUM_STRATEGY_VERSION,
        universe_slug: json.universe_slug ?? SECTOR_MOMENTUM_UNIVERSE_SLUG,
        candidates_count: json.candidates_count ?? 0,
        persisted_rows: json.persisted_rows ?? 0,
        pruned_rows: json.pruned_rows ?? 0,
      };
    });
    stages.push(stage);
  }

  if (dry_run) {
    stages.push({
      stage: "midcap_scan",
      ok: true,
      duration_ms: 0,
      detail: {
        skipped: true,
        reason: "dry_run=true",
      },
    });
  } else {
    const stage = await runStage("midcap_scan", async () => {
      if (!scan_date_used) throw new Error("scan_date_used unavailable for midcap scan");
      const momentum = await runScanPipeline({
        supabase: supa,
        universe_slug: MIDCAP_UNIVERSE_SLUG,
        strategy_version: "v1",
        scan_date: scan_date_used,
        finalize: true,
      });
      if (!momentum?.ok) throw new Error(String(momentum?.error ?? "midcap momentum failed"));
      const trend = await runScanPipeline({
        supabase: supa,
        universe_slug: MIDCAP_UNIVERSE_SLUG,
        strategy_version: TREND_HOLD_DEFAULT_VERSION,
        scan_date: scan_date_used,
        finalize: true,
      });
      if (!trend?.ok) throw new Error(String(trend?.error ?? "midcap trend failed"));
      return {
        scan_date_used,
        universe_slug: MIDCAP_UNIVERSE_SLUG,
        momentum_strategy_version: "v1",
        momentum_scored: momentum.scored ?? 0,
        trend_scored: trend.scored ?? 0,
      };
    });
    stages.push(stage);
  }

  if (!dry_run) {
    const stage = await runStage("midcap_sector_scan", async () => {
      const res = await runPopulate({ universe_slug: MIDCAP_UNIVERSE_SLUG });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.error ?? "midcap sector populate failed"));
      }
      return {
        scan_date_used: json.scan_date_used ?? scan_date_used ?? null,
        universe_slug: MIDCAP_UNIVERSE_SLUG,
        strategy_version: json.strategy_version ?? SECTOR_MOMENTUM_STRATEGY_VERSION,
        candidates_count: json.candidates_count ?? 0,
        persisted_rows: json.persisted_rows ?? 0,
      };
    });
    stages.push(stage);
  }

  if (dry_run) {
    stages.push({
      stage: "breadth_snapshot",
      ok: true,
      duration_ms: 0,
      detail: {
        skipped: true,
        reason: "dry_run=true",
      },
    });
    stages.push({
      stage: "diagnostics",
      ok: true,
      duration_ms: 0,
      detail: {
        skipped: true,
        reason: "dry_run=true",
      },
    });
  } else {
    const breadthStage = await runStage("breadth_snapshot", async () => {
      if (!scan_date_used) {
        throw new Error("scan_date_used unavailable for breadth snapshot");
      }
      const momentumBreadth = await computeMarketBreadth({
        supabase: supa,
        date: scan_date_used,
        universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
        strategy_version: CORE_MOMENTUM_DEFAULT_VERSION,
        regime_state,
      });
      const trendBreadth = await computeMarketBreadth({
        supabase: supa,
        date: scan_date_used,
        universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE,
        strategy_version: TREND_HOLD_DEFAULT_VERSION,
        regime_state,
      });
      return {
        scan_date_used,
        momentum: {
          pct_above_sma50: momentumBreadth.pctAboveSma50,
          pct_above_sma200: momentumBreadth.pctAboveSma200,
          sample_size: momentumBreadth.sampleSize,
        },
        trend: {
          pct_above_sma50: trendBreadth.pctAboveSma50,
          pct_above_sma200: trendBreadth.pctAboveSma200,
          sample_size: trendBreadth.sampleSize,
        },
        sector: sector?.breadth ?? null,
      };
    });
    stages.push(breadthStage);

    const diagnosticsStage = await runStage("diagnostics", async () => {
      const diagnostics = await runDiagnosticsWithClient(supa);
      return {
        ok: diagnostics.ok,
        lctd_vs_scans_ok: diagnostics.checks.lctd_vs_scans.ok,
        caps_ok: diagnostics.checks.caps.ok,
        regime_freshness_ok: diagnostics.checks.regime_freshness.ok,
      };
    });
    stages.push(diagnosticsStage);
  }

  const failed = stages.filter((s) => !s.ok);
  const payload = {
    ok: failed.length === 0,
    dry_run,
    scan_date_used,
    regime_state,
    regime_stale,
    stages,
    summary: {
      momentum: autopilot?.momentum ?? null,
      trend: autopilot?.trend ?? null,
      sector: sector
        ? {
            candidates_count: sector.candidates_count ?? 0,
            strategy_version: sector.strategy_version ?? SECTOR_MOMENTUM_STRATEGY_VERSION,
            universe_slug: sector.universe_slug ?? SECTOR_MOMENTUM_UNIVERSE_SLUG,
          }
        : null,
    },
    duration_ms: Date.now() - startedAt,
  };

  await writeObservabilityStatus({
    supabase: supa,
    key: OBS_KEYS.scheduler,
    value: payload,
  }).catch(() => null);

  return payload;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
    const payload = await runWorkflow({ dry_run: body?.dry_run === true });
    return NextResponse.json(payload, { status: payload.ok ? 200 : 500 });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    await writeObservabilityStatus({
      key: OBS_KEYS.scheduler,
      value: {
        ok: false,
        error,
      },
    }).catch(() => null);
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dry_run = String(url.searchParams.get("dry_run") ?? "").trim() === "1";
  const payload = await runWorkflow({ dry_run });
  return NextResponse.json(payload, { status: payload.ok ? 200 : 500 });
}
