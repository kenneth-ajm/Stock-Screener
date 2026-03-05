import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as scanPost } from "@/app/api/scan/route";

type Body = {
  universe_slug?: string;
  strategy_version?: string;
};

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY_VERSION = "v2_core_momentum";
const BUY_CAP = 5;
const WATCH_CAP = 10;

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
  if (!latest) throw new Error("SPY bars unavailable for regime computation");

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

async function getLatestSpyScanDate(supa: any) {
  const { data, error } = await supa
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .order("date", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message ?? "Failed to resolve latest SPY scan date");
  const d = data?.[0]?.date;
  return d ? String(d) : null;
}

async function finalizeCappedSignals(opts: {
  supa: any;
  date_used: string;
  universe_slug: string;
  strategy_version: string;
  buyCap: number;
  watchCap: number;
}) {
  const { supa, date_used, universe_slug, strategy_version, buyCap, watchCap } = opts;

  const { data, error } = await supa
    .from("daily_scans")
    .select("date,universe_slug,strategy_version,symbol,signal,confidence,reason_summary,reason_json,updated_at")
    .eq("date", date_used)
    .eq("universe_slug", universe_slug)
    .eq("strategy_version", strategy_version);
  if (error) throw new Error(error.message ?? "Failed to load rows for finalization");

  const rows = Array.isArray(data) ? data : [];
  const rank = (a: any, b: any) => {
    const ac = Number(a?.confidence ?? 0);
    const bc = Number(b?.confidence ?? 0);
    if (bc !== ac) return bc - ac;
    return String(a?.symbol ?? "").localeCompare(String(b?.symbol ?? ""));
  };

  const bySymbol = new Map<string, any>();
  for (const r of rows) bySymbol.set(String(r.symbol), { ...r });

  const buys = rows.filter((r: any) => r.signal === "BUY").sort(rank);
  for (let i = buyCap; i < buys.length; i++) {
    const sym = String(buys[i].symbol);
    const cur = bySymbol.get(sym);
    if (cur) cur.signal = "WATCH";
  }

  const watchesAfterBuyPass = [...bySymbol.values()].filter((r: any) => r.signal === "WATCH").sort(rank);
  for (let i = watchCap; i < watchesAfterBuyPass.length; i++) {
    const sym = String(watchesAfterBuyPass[i].symbol);
    const cur = bySymbol.get(sym);
    if (cur) cur.signal = "AVOID";
  }

  const updates: any[] = [];
  for (const original of rows) {
    const updated = bySymbol.get(String(original.symbol));
    if (!updated) continue;
    if (updated.signal === original.signal) continue;
    const priorReasonJson =
      original.reason_json && typeof original.reason_json === "object" ? original.reason_json : {};
    const capAdjustment =
      original.signal === "BUY" && updated.signal === "WATCH"
        ? "BUY overflow downgraded to WATCH (final cap pass)"
        : original.signal === "WATCH" && updated.signal === "AVOID"
          ? "WATCH overflow downgraded to AVOID (final cap pass)"
          : "Signal adjusted by final cap pass";

    updates.push({
      date: String(original.date),
      universe_slug: String(original.universe_slug),
      strategy_version: String(original.strategy_version),
      symbol: String(original.symbol),
      signal: updated.signal,
      reason_summary: `${String(original.reason_summary ?? "").trim()} • ${capAdjustment}`.trim(),
      reason_json: {
        ...priorReasonJson,
        cap_adjustment: capAdjustment,
        capped_signal: updated.signal,
      },
      updated_at: new Date().toISOString(),
    });
  }

  if (updates.length > 0) {
    const { error: upErr } = await supa
      .from("daily_scans")
      .upsert(updates, { onConflict: "date,universe_slug,strategy_version,symbol" });
    if (upErr) throw new Error(upErr.message ?? "Failed to persist cap finalization");
  }

  const finalRows = [...bySymbol.values()];
  return {
    updated: updates.length,
    final_buy_count: finalRows.filter((r: any) => r.signal === "BUY").length,
    final_watch_count: finalRows.filter((r: any) => r.signal === "WATCH").length,
    final_avoid_count: finalRows.filter((r: any) => r.signal === "AVOID").length,
  };
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;

    const body = (await req.json().catch(() => ({}))) as Body;
    const universe_slug = String(body?.universe_slug ?? DEFAULT_UNIVERSE).trim() || DEFAULT_UNIVERSE;
    const strategy_version =
      String(body?.strategy_version ?? DEFAULT_STRATEGY_VERSION).trim() || DEFAULT_STRATEGY_VERSION;
    const date_used = await getLatestSpyScanDate(supa);
    if (!date_used) {
      return NextResponse.json(
        { ok: false, error: "No SPY bars available in price_bars to determine scan_date" },
        { status: 500 }
      );
    }
    const regime_state = await refreshSpyRegimeForDate(date_used);

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
          scan_date: date_used,
          date_used,
          regime_state,
          batches_ok,
          batches_failed,
        },
        { status: 500 }
      );
    }

    const finalization = await finalizeCappedSignals({
      supa,
      date_used,
      universe_slug,
      strategy_version,
      buyCap: BUY_CAP,
      watchCap: WATCH_CAP,
    });

    return NextResponse.json({
      ok: true,
      universe_slug,
      strategy_version,
      scan_date: date_used,
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
      finalization,
      duration_ms: Date.now() - startedAt,
    });
  } catch (e: unknown) {
    console.error("rescan-latest error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
