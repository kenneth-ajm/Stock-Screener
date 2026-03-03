import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchAggs(symbol: string, apiKey: string, from: string, to: string) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
    symbol
  )}/range/1/day/${from}/${to}?adjusted=false&sort=asc&limit=50000&apiKey=${apiKey}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { ok: false, results: [], error: `Polygon ${res.status}` };
  const json = await res.json().catch(() => null);
  const results = Array.isArray(json?.results) ? json.results : [];
  return { ok: true, results, error: null as string | null };
}

export async function POST(req: Request) {
  const apiKey = process.env.POLYGON_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
  if (!supabaseUrl || !serviceKey)
    return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 });

  const supabase = createClient(supabaseUrl, serviceKey);

  const body = await req.json().catch(() => ({}));
  const batchSize = typeof body?.batch_size === "number" ? Math.max(5, Math.min(150, body.batch_size)) : 50;
  const universeSlug =
    typeof body?.universe_slug === "string" && body.universe_slug.trim()
      ? body.universe_slug.trim()
      : "liquid_2000";

  const to = isoDate(new Date());
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = isoDate(fromDate);

  // Ensure RPC exists
  const { data: need, error: rpcErr } = await supabase.rpc("symbols_needing_history", {
    universe_slug_input: universeSlug,
    min_bars: 220,
  });

  if (rpcErr) {
    return NextResponse.json({ ok: false, error: `RPC failed: ${rpcErr.message}` }, { status: 500 });
  }

  const symbols: string[] = Array.isArray(need) ? need.map((x: any) => String(x.symbol).toUpperCase()) : [];
  if (symbols.length === 0) {
    return NextResponse.json({ ok: true, message: "All symbols already have >=220 bars." });
  }

  const targets = symbols.slice(0, batchSize);

  const ingested: Array<{ symbol: string; rows_upserted: number; bars_after: number }> = [];
  const failed: Array<{ symbol: string; reason: string }> = [];

  for (const symbol of targets) {
    const { ok, results, error } = await fetchAggs(symbol, apiKey, from, to);
    if (!ok || results.length === 0) {
      failed.push({ symbol, reason: error || "No results" });
      continue;
    }

    const rows = results.map((r: any) => ({
      symbol,
      date: new Date(r.t).toISOString().slice(0, 10), // YYYY-MM-DD
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: Math.round(r.v),
      source: "polygon",
    }));

    // IMPORTANT: Ensure your price_bars unique constraint is on (symbol, date).
    // If your constraint name differs, Supabase still needs the column list.
    const { error: upErr } = await supabase.from("price_bars").upsert(rows, {
      onConflict: "symbol,date",
    });

    if (upErr) {
      failed.push({ symbol, reason: `Upsert failed: ${upErr.message}` });
      continue;
    }

    const { data: cnt, error: cntErr } = await supabase
      .from("price_bars")
      .select("symbol", { count: "exact", head: true })
      .eq("symbol", symbol);

    if (cntErr) {
      ingested.push({ symbol, rows_upserted: rows.length, bars_after: -1 });
    } else {
      // @ts-ignore count exists on response
      ingested.push({ symbol, rows_upserted: rows.length, bars_after: (cnt as any)?.count ?? -1 });
    }
  }

  // Recompute remaining
  const { data: needAfter } = await supabase.rpc("symbols_needing_history", {
    universe_slug_input: universeSlug,
    min_bars: 220,
  });

  const remaining = Array.isArray(needAfter) ? needAfter.length : null;

  return NextResponse.json({
    ok: true,
    attempted: targets.length,
    ingested_count: ingested.length,
    remaining_to_fill: remaining,
    universe_slug: universeSlug,
    ingested,
    failed,
    note: "If remaining_to_fill does not decrease, check price_bars unique constraint on (symbol, date).",
  });
}
