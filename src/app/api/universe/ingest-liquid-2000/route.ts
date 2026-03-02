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
  const results = Array.isArray(json?.results) ? json.results : [];
  return results;
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
  const batchSize = typeof body?.batch_size === "number" ? Math.max(5, Math.min(75, body.batch_size)) : 25;

  // 2 years of daily bars (enough for SMA200 + buffer)
  const to = isoDate(new Date());
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = isoDate(fromDate);

  // Find universe id
  const { data: uni } = await supabase.from("universes").select("id, slug").eq("slug", "liquid_2000").maybeSingle();
  if (!uni?.id) {
    return NextResponse.json({ ok: false, error: "Universe liquid_2000 not found. Run build-liquid-2000 first." }, { status: 400 });
  }

  // Get active members
  const { data: members, error: memErr } = await supabase
    .from("universe_members")
    .select("symbol")
    .eq("universe_id", uni.id)
    .eq("active", true);

  if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });

  const symbols = (members ?? []).map((m: any) => String(m.symbol).toUpperCase()).filter(Boolean);
  if (!symbols.length) return NextResponse.json({ ok: false, error: "No active members in liquid_2000" }, { status: 400 });

  // Determine which symbols are missing enough history (count < 220)
  // NOTE: Supabase doesn't support GROUP BY well via postgrest in a single call without RPC.
  // We'll do a cheap heuristic: sample candidates by checking latest bar exists; if not, ingest.
  // Also allow forcing ingest for a provided list.
  const forceSymbols = Array.isArray(body?.symbols) ? body.symbols.map((s: any) => String(s).toUpperCase()) : [];

  let candidates = forceSymbols.length ? forceSymbols : symbols;

  // Only take first N candidates and ingest them; repeated runs will gradually fill the DB.
  candidates = Array.from(new Set(candidates)).slice(0, batchSize);

  const ingested: { symbol: string; bars: number }[] = [];
  const failed: { symbol: string; reason: string }[] = [];

  for (const symbol of candidates) {
    try {
      const results = await fetchAggs(symbol, apiKey, from, to);
      if (!results || results.length === 0) {
        failed.push({ symbol, reason: "No results from Polygon aggs" });
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

      const { error: upErr } = await supabase.from("price_bars").upsert(rows, { onConflict: "symbol,date" });
      if (upErr) {
        failed.push({ symbol, reason: upErr.message });
        continue;
      }

      ingested.push({ symbol, bars: rows.length });
    } catch (e: any) {
      failed.push({ symbol, reason: e?.message ?? "Unknown error" });
    }
  }

  return NextResponse.json({
    ok: true,
    universe_slug: "liquid_2000",
    batch_size: batchSize,
    from,
    to,
    attempted: candidates.length,
    ingested,
    failed,
    note: "Run this endpoint repeatedly until most symbols have >=220 bars in price_bars, then run /api/scan with universe_slug=liquid_2000.",
  });
}