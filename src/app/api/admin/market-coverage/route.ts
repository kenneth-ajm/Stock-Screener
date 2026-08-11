import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  finalizeMarketCoverage,
  initializeMarketCoverage,
  marketCoverageStatus,
  rebuildAndPrepareHistory,
  runDiscoveryBatch,
  runHistoryBatch,
} from "@/lib/market_coverage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Normal production requests are protected by the Supabase session boundary
// in src/proxy.ts. Individual batch calls therefore need no browser-visible admin secret.

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server configuration");
  return createClient(url, key);
}

export async function GET() {
  try {
    return NextResponse.json(await marketCoverageStatus(serviceClient()));
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      discovery_sessions?: number;
      history_batch_size?: number;
    };
    const action = String(body.action ?? "status");
    const supabase = serviceClient();
    const polygonApiKey = process.env.POLYGON_API_KEY;
    let result: Record<string, unknown>;

    if (action === "initialize") {
      if (!polygonApiKey) throw new Error("Missing POLYGON_API_KEY");
      result = await initializeMarketCoverage({
        supabase,
        polygonApiKey,
        discoverySessions: body.discovery_sessions,
      });
    } else if (action === "discovery_batch") {
      result = await runDiscoveryBatch(supabase);
    } else if (action === "rebuild") {
      if (!polygonApiKey) throw new Error("Missing POLYGON_API_KEY");
      result = await rebuildAndPrepareHistory({ supabase, polygonApiKey });
    } else if (action === "history_batch") {
      result = await runHistoryBatch(supabase, body.history_batch_size);
    } else if (action === "finalize") {
      result = await finalizeMarketCoverage(supabase);
    } else if (action === "status") {
      result = await marketCoverageStatus(supabase);
    } else {
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    console.info("[market-coverage] request", {
      action,
      ok: true,
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ ...result, duration_ms: Date.now() - startedAt });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[market-coverage] request_failed", {
      error: message,
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      { ok: false, error: message, duration_ms: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
