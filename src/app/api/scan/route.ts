import { NextResponse } from "next/server";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
} from "@/lib/strategy/coreMomentumSwing";
import { makeScanEngineClient, runScanPipeline } from "@/lib/scan_engine";

type ScanBody = {
  universe_slug?: string;
  version?: string;
  strategy_version?: string;
  offset?: number;
  limit?: number;
  scan_date?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ScanBody;
    const universe_slug = body.universe_slug ?? CORE_MOMENTUM_DEFAULT_UNIVERSE;
    const strategy_version = body.strategy_version ?? body.version ?? CORE_MOMENTUM_DEFAULT_VERSION;
    const offset = Number.isFinite(body.offset as number) ? Number(body.offset) : 0;
    const limit = Number.isFinite(body.limit as number) ? Number(body.limit) : 200;

    const supabase = makeScanEngineClient();
    const result = await runScanPipeline({
      supabase,
      universe_slug,
      strategy_version,
      scan_date: body.scan_date,
      offset,
      limit,
      finalize: false,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
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
