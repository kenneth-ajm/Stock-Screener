import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as ingestUniversePost } from "@/app/api/universe/ingest-liquid-2000/route";

const UNIVERSE_SLUG = "core_800";

function toInt(v: unknown, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const batchSize = Math.max(10, Math.min(50, toInt(body.batch_size, 25)));
    const offset = Math.max(0, toInt(body.offset, 0));

    const { data: universe, error: universeErr } = await supabase
      .from("universes")
      .select("id")
      .eq("slug", UNIVERSE_SLUG)
      .maybeSingle();
    if (universeErr) {
      return NextResponse.json(
        { ok: false, error: universeErr.message, detail: universeErr.details ?? null },
        { status: 500 }
      );
    }
    if (!universe?.id) {
      return NextResponse.json(
        { ok: false, error: `Universe not found: ${UNIVERSE_SLUG}`, detail: null },
        { status: 404 }
      );
    }

    const { count: universeSize, error: countErr } = await supabase
      .from("universe_members")
      .select("symbol", { count: "exact", head: true })
      .eq("universe_id", universe.id)
      .eq("active", true);
    if (countErr) {
      return NextResponse.json(
        { ok: false, error: countErr.message, detail: countErr.details ?? null },
        { status: 500 }
      );
    }

    const ingestReq = new Request("http://localhost/api/universe/ingest-liquid-2000", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        universe_slug: UNIVERSE_SLUG,
        limit: batchSize,
        offset,
      }),
    });
    const ingestRes = await ingestUniversePost(ingestReq);
    const ingestJson = await ingestRes.json().catch(() => null);
    if (!ingestRes.ok || !ingestJson?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: ingestJson?.error ?? `Ingest batch failed (${ingestRes.status})`,
          detail: ingestJson?.detail ?? ingestJson ?? null,
        },
        { status: ingestRes.status || 500 }
      );
    }

    const nextOffset = offset + batchSize;
    const done = nextOffset >= Number(universeSize ?? 0);

    return NextResponse.json({
      ok: true,
      universe_slug: UNIVERSE_SLUG,
      batch_size: batchSize,
      offset,
      next_offset: nextOffset,
      done,
      symbols_attempted: ingestJson.symbols_attempted ?? 0,
      symbols_succeeded: ingestJson.symbols_succeeded ?? 0,
      total_rows_upserted: ingestJson.total_rows_upserted ?? 0,
      failed: ingestJson.failed ?? [],
      duration_ms: Date.now() - startedAt,
    });
  } catch (e: unknown) {
    console.error("backfill-core-800 error", e);
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error: message, detail }, { status: 500 });
  }
}
