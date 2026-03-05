import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
} from "@/lib/strategy/coreMomentumSwing";
import { getLCTD } from "@/lib/scan_date";
import { runScanPipeline, type ScanEngineClient } from "@/lib/scan_engine";
import { finalizeSignals } from "@/lib/finalize_signals";
import { runDiagnosticsWithClient } from "@/lib/diagnostics";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";

type Body = {
  universe_slug?: string;
  strategy_version?: string;
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const universe_slug = String(body?.universe_slug ?? CORE_MOMENTUM_DEFAULT_UNIVERSE).trim() || CORE_MOMENTUM_DEFAULT_UNIVERSE;
    const strategy_version =
      String(body?.strategy_version ?? CORE_MOMENTUM_DEFAULT_VERSION).trim() || CORE_MOMENTUM_DEFAULT_VERSION;

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as ScanEngineClient;
    const supaAny = supa as any;

    const lctd = await getLCTD(supaAny);
    if (!lctd.ok || !lctd.scan_date) {
      return NextResponse.json(
        { ok: false, error: lctd.error ?? "Failed to resolve scan date", detail: null },
        { status: 500 }
      );
    }

    const { data: universeRow, error: universeErr } = await supaAny
      .from("universes")
      .select("id")
      .eq("slug", universe_slug)
      .maybeSingle();
    if (universeErr || !universeRow?.id) {
      return NextResponse.json(
        { ok: false, error: `Universe not found: ${universe_slug}`, detail: universeErr?.message ?? null },
        { status: 400 }
      );
    }

    const { count: memberCount, error: countErr } = await supaAny
      .from("universe_members")
      .select("symbol", { count: "exact", head: true })
      .eq("universe_id", universeRow.id)
      .eq("active", true);
    if (countErr) {
      return NextResponse.json({ ok: false, error: countErr.message, detail: null }, { status: 500 });
    }

    const batchLimit = 100;
    const totalMembers = Number(memberCount ?? 0);
    const estimatedBatches = Math.max(1, Math.ceil(totalMembers / batchLimit));

    let totalProcessed = 0;
    let totalScored = 0;
    let totalUpserted = 0;
    let batches_ok = 0;
    let batches_failed = 0;
    let first_error: unknown = null;
    let regime_state: string | null = null;
    let regime_stale = false;
    let scan_date_used = lctd.scan_date;

    for (let batch = 0; batch < estimatedBatches; batch += 1) {
      const offset = batch * batchLimit;
      const result = await runScanPipeline({
        supabase: supaAny,
        universe_slug,
        strategy_version,
        scan_date: scan_date_used,
        offset,
        limit: batchLimit,
        finalize: false,
      });

      if (!result.ok) {
        batches_failed += 1;
        if (!first_error) {
          first_error = {
            batch,
            offset,
            error: result.error ?? "Batch scan failed",
          };
        }
        continue;
      }

      batches_ok += 1;
      totalProcessed += Number(result.processed ?? 0);
      totalScored += Number(result.scored ?? 0);
      totalUpserted += Number(result.upserted ?? 0);
      regime_state = String(result.regime_state ?? regime_state ?? "FAVORABLE");
      regime_stale = Boolean(result.regime_stale ?? regime_stale);
      scan_date_used = String(result.scan_date_used ?? scan_date_used);

      if (Number(result.processed ?? 0) < batchLimit) break;
    }

    if (batches_ok === 0 && batches_failed > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "All scan batches failed",
          detail: first_error,
          universe_slug,
          strategy_version,
          scan_date_used,
          batches_ok,
          batches_failed,
        },
        { status: 500 }
      );
    }

    const strategiesToFinalize = [
      CORE_MOMENTUM_DEFAULT_VERSION,
      TREND_HOLD_DEFAULT_VERSION,
    ];
    const finalizeUniverse = CORE_MOMENTUM_DEFAULT_UNIVERSE;
    const finalizationResults: Record<string, unknown> = {};
    for (const sv of strategiesToFinalize) {
      const finalization = await finalizeSignals({
        supabase: supaAny,
        date: scan_date_used,
        universe_slug: finalizeUniverse,
        strategy_version: sv,
      });
      if (!finalization.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: `Finalization failed for ${sv}: ${finalization.error ?? "unknown"}`,
            detail: null,
          },
          { status: 500 }
        );
      }
      finalizationResults[sv] = finalization;
    }

    const diagnostics = await runDiagnosticsWithClient(supaAny);
    const diagnosticsSummary = {
      ok: diagnostics.ok,
      lctd_vs_scans_ok: diagnostics.checks.lctd_vs_scans.ok,
      caps_ok: diagnostics.checks.caps.ok,
    };
    if (!diagnosticsSummary.lctd_vs_scans_ok || !diagnosticsSummary.caps_ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Post-rescan diagnostics failed",
          detail: diagnosticsSummary,
          universe_slug,
          strategy_version,
          scan_date_used,
          finalization: finalizationResults,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      universe_slug,
      strategy_version,
      scan_date_used,
      lctd_source: lctd.lctd_source,
      regime_state,
      regime_stale,
      batch_limit: batchLimit,
      estimated_batches: estimatedBatches,
      batches_ok,
      batches_failed,
      first_error,
      processed: totalProcessed,
      scored: totalScored,
      upserted: totalUpserted,
      finalization: finalizationResults,
      diagnostics_summary: diagnosticsSummary,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e: unknown) {
    console.error("rescan-latest error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
