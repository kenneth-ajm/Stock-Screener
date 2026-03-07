import { NextResponse } from "next/server";
import { makeScanEngineClient } from "@/lib/scan_engine";
import { runDerivedScanBackfill } from "@/lib/backfill_derived_scans";

type Body = {
  start_date?: string;
  end_date?: string;
  strategies?: string[];
  dry_run?: boolean;
  execute?: boolean;
  max_days?: number;
  include_breadth_preview?: boolean;
  tiny_test?: boolean;
  tiny_days?: number;
};

function clampMaxDays(input: unknown) {
  const n = Number(input);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(30, Math.floor(n)));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const start_date = String(body.start_date ?? "").slice(0, 10);
    const end_date = String(body.end_date ?? "").slice(0, 10);
    if (!start_date || !end_date) {
      return NextResponse.json({ ok: false, error: "start_date and end_date are required" }, { status: 400 });
    }
    const tiny_test = body.tiny_test === true;
    const max_days = tiny_test
      ? Math.max(5, Math.min(10, clampMaxDays(body.tiny_days ?? body.max_days ?? 7)))
      : clampMaxDays(body.max_days);
    const execute = tiny_test ? true : body.execute === true;
    if (execute && max_days > 10) {
      return NextResponse.json(
        {
          ok: false,
          error: "Execution guard: max_days > 10 is blocked for this route. Use <= 10.",
        },
        { status: 400 }
      );
    }

    const supabase = makeScanEngineClient();
    const summary = await runDerivedScanBackfill({
      supabase,
      input: {
        start_date,
        end_date,
        strategies: tiny_test ? ["v2_core_momentum"] : Array.isArray(body.strategies) ? body.strategies : undefined,
        dry_run: body.dry_run,
        execute,
        max_days,
        include_breadth_preview: body.include_breadth_preview,
        dedupe_skip_existing: tiny_test ? true : false,
      },
    });

    if (tiny_test) {
      const momentumOnly = summary.per_strategy.filter((s) => s.strategy_version === "v2_core_momentum");
      return NextResponse.json({
        ...summary,
        mode: "execute",
        strategies: ["v2_core_momentum"],
        per_strategy: momentumOnly,
        tiny_test: {
          enabled: true,
          strategy_version: "v2_core_momentum",
          universe_slug: "core_800",
          max_days,
          note: "Tiny safe replay mode executed with dedupe_skip_existing=true.",
        },
        safety: {
          execute: true,
          max_days,
          dedupe_skip_existing: true,
          note: "Tiny mode writes derived momentum rows only; no raw ingestion.",
        },
      });
    }

    return NextResponse.json({
      ...summary,
      safety: {
        execute,
        max_days,
        dedupe_skip_existing: false,
        note: execute
          ? "Execute mode writes derived rows only; no raw price ingestion."
          : "Dry-run only. No rows were written.",
      },
    });
  } catch (e: unknown) {
    console.error("backfill-derived-scans error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
