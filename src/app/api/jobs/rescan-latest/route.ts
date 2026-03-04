import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as scanPost } from "@/app/api/scan/route";
import { lastCompletedUsTradingDay } from "@/lib/tradingDay";

type Body = {
  universe_slug?: string;
  strategy_version?: string;
};

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY_VERSION = "v2_core_momentum";

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

async function refreshSpyRegimeForDate(dateUsed: string) {
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as any;

  const { data: bars, error } = await supa
    .from("price_bars")
    .select("date,close")
    .eq("symbol", "SPY")
    .lte("date", dateUsed)
    .order("date", { ascending: false })
    .limit(260);
  if (error) throw new Error(error.message ?? "Failed to read SPY bars");
  if (!Array.isArray(bars) || bars.length < 200) throw new Error("Not enough SPY bars to compute regime");

  const latest = bars[0];
  if (!latest || String(latest.date) !== dateUsed) {
    throw new Error(`SPY bar missing for ${dateUsed}`);
  }

  const asc = [...bars].reverse();
  const closes = asc.map((b: any) => Number(b.close));
  const sma200 = sma(closes, 200);
  if (!sma200) throw new Error("Unable to compute SPY SMA200");
  const close = Number(latest.close);
  const state = close > sma200 ? "FAVORABLE" : "DEFENSIVE";

  const { error: upErr } = await supa.from("market_regime").upsert(
    {
      symbol: "SPY",
      date: dateUsed,
      close,
      sma200,
      state,
    },
    { onConflict: "symbol,date" }
  );
  if (upErr) throw new Error(upErr.message ?? "Failed to upsert market regime");
  return state;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const universe_slug = String(body?.universe_slug ?? DEFAULT_UNIVERSE).trim() || DEFAULT_UNIVERSE;
    const strategy_version =
      String(body?.strategy_version ?? DEFAULT_STRATEGY_VERSION).trim() || DEFAULT_STRATEGY_VERSION;
    const date_used = lastCompletedUsTradingDay();
    const regime_state = await refreshSpyRegimeForDate(date_used);

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;

    const { data: universeRow, error: universeErr } = await supa
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

    const { count: memberCount, error: countErr } = await supa
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
    const maxBatches = Math.min(estimatedBatches, 16);

    let totalProcessed = 0;
    let totalScored = 0;
    let totalUpserted = 0;
    let batches_ok = 0;
    let batches_failed = 0;
    let first_error: unknown = null;

    for (let batch = 0; batch < maxBatches; batch++) {
      const offset = batch * batchLimit;
      const scanReq = new Request("http://localhost/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          universe_slug,
          strategy_version,
          scan_date: date_used,
          offset,
          limit: batchLimit,
        }),
      });

      const scanRes = await scanPost(scanReq);
      const scanJson = (await scanRes.json().catch(() => null)) as any;
      if (!scanRes.ok || !scanJson?.ok) {
        batches_failed += 1;
        if (!first_error) {
          first_error = {
            batch,
            offset,
            status: scanRes.status,
            error: scanJson?.error ?? `Scan failed with status ${scanRes.status}`,
            detail: scanJson?.detail ?? null,
          };
        }
        continue;
      }

      batches_ok += 1;
      totalProcessed += Number(scanJson?.processed ?? 0);
      totalScored += Number(scanJson?.scored ?? 0);
      totalUpserted += Number(scanJson?.upserted ?? 0);

      if (Number(scanJson?.processed ?? 0) < batchLimit) break;
    }

    if (batches_ok === 0 && batches_failed > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "All scan batches failed",
          detail: first_error,
          universe_slug,
          strategy_version,
          date_used,
          regime_state,
          batches_ok,
          batches_failed,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      universe_slug,
      strategy_version,
      date_used,
      regime_state,
      batch_limit: batchLimit,
      estimated_batches: estimatedBatches,
      batches_ok,
      batches_failed,
      first_error,
      processed: totalProcessed,
      scored: totalScored,
      upserted: totalUpserted,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e: unknown) {
    console.error("rescan-latest error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
