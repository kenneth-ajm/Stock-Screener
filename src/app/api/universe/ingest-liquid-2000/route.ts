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
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return Array.isArray(json?.results) ? json.results : [];
}

export async function POST(req: Request) {
  const apiKey = process.env.POLYGON_API_KEY;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const body = await req.json().catch(() => ({}));
  const batchSize = typeof body?.batch_size === "number" ? body.batch_size : 50;

  const to = isoDate(new Date());
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = isoDate(fromDate);

  // get universe id
  const { data: uni } = await supabase
    .from("universes")
    .select("id")
    .eq("slug", "liquid_2000")
    .maybeSingle();

  if (!uni?.id) {
    return NextResponse.json({ ok: false, error: "liquid_2000 not found" });
  }

  // find symbols with <220 bars
  const { data: symbols } = await supabase
    .rpc("symbols_needing_history", { universe_slug_input: "liquid_2000", min_bars: 220 });

  if (!symbols || symbols.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "All symbols already have sufficient history.",
    });
  }

  const targets = symbols.slice(0, batchSize).map((s: any) => s.symbol);

  const ingested: any[] = [];
  const failed: any[] = [];

  for (const symbol of targets) {
    const results = await fetchAggs(symbol, apiKey!, from, to);
    if (!results || results.length === 0) {
      failed.push(symbol);
      continue;
    }

    const rows = results.map((r: any) => ({
      symbol,
      date: new Date(r.t).toISOString().slice(0, 10),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: Math.round(r.v),
      source: "polygon",
    }));

    await supabase.from("price_bars").upsert(rows, {
      onConflict: "symbol,date",
    });

    ingested.push(symbol);
  }

  return NextResponse.json({
    ok: true,
    ingested_count: ingested.length,
    remaining_to_fill: symbols.length - ingested.length,
    next_batch_size: batchSize,
  });
}