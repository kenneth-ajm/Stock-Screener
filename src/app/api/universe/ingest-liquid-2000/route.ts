import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function toInt(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parseString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

async function fetchAggs(symbol: string, apiKey: string, from: string, to: string) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
    symbol
  )}/range/1/day/${from}/${to}?adjusted=false&sort=asc&limit=50000&apiKey=${apiKey}`;

  const controller = new AbortController();
  const timeoutMs = 12000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(url, { cache: "no-store", signal: controller.signal }).catch((e: unknown) => {
    const message = e instanceof Error ? e.message : "Unknown fetch error";
    return { ok: false, status: 0, _err: message } as const;
  });
  clearTimeout(timeout);

  if (!res || (typeof res === "object" && "_err" in res)) {
    const err = (res as { _err?: string } | null)?._err ?? "Fetch failed";
    return { ok: false, results: [], error: err };
  }

  if (!res.ok) return { ok: false, results: [], error: `Polygon ${res.status}` };
  const json = (await res.json().catch(() => null)) as { results?: Array<Record<string, unknown>> } | null;
  const results = Array.isArray(json?.results) ? json.results : [];
  return { ok: true, results, error: null as string | null };
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const apiKey = process.env.POLYGON_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
  if (!supabaseUrl || !serviceKey)
    return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 });

  const supabase = createClient(supabaseUrl, serviceKey);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = new URL(req.url);
  const bodyUniverse = parseString(body?.universe_slug);
  const queryUniverse = parseString(url.searchParams.get("universe_slug"));
  const universeSlug = bodyUniverse ?? queryUniverse ?? "core_800";

  const bodyLimit = toInt(body?.limit ?? body?.batch_size);
  const queryLimit = toInt(url.searchParams.get("limit"));
  const limit = Math.max(10, Math.min(50, bodyLimit ?? queryLimit ?? 20));

  const bodyOffset = toInt(body?.offset);
  const queryOffset = toInt(url.searchParams.get("offset"));
  const offset = Math.max(0, bodyOffset ?? queryOffset ?? 0);

  const { data: universe, error: universeErr } = await supabase
    .from("universes")
    .select("id,slug")
    .eq("slug", universeSlug)
    .maybeSingle();
  if (universeErr) {
    return NextResponse.json({ ok: false, error: universeErr.message }, { status: 500 });
  }
  if (!universe) {
    return NextResponse.json({ ok: false, error: `Universe not found: ${universeSlug}` }, { status: 404 });
  }

  const { data: members, error: membersErr } = await supabase
    .from("universe_members")
    .select("symbol")
    .eq("universe_id", universe.id)
    .eq("active", true)
    .order("symbol", { ascending: true })
    .range(offset, offset + limit - 1);
  if (membersErr) {
    return NextResponse.json({ ok: false, error: membersErr.message }, { status: 500 });
  }

  const symbols = (members ?? []).map((m) => String(m.symbol ?? "").toUpperCase()).filter(Boolean);
  if (symbols.length === 0) {
    return NextResponse.json({
      ok: true,
      universe_slug: universeSlug,
      offset,
      limit,
      symbols_attempted: 0,
      symbols_succeeded: 0,
      total_rows_upserted: 0,
      failed: [],
      duration_ms: Date.now() - startedAt,
      note: "No active symbols in this batch range",
    });
  }

  const to = isoDate(new Date());
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = isoDate(fromDate);
  const failed: Array<{ symbol: string; error: string }> = [];
  let symbolsSucceeded = 0;
  let totalRowsUpserted = 0;

  for (const symbol of symbols) {
    const { ok, results, error } = await fetchAggs(symbol, apiKey, from, to);
    if (!ok || results.length === 0) {
      failed.push({ symbol, error: error || "No results" });
      continue;
    }

    const rows: Array<{
      symbol: string;
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      source: string;
    }> = [];

    for (const r of results) {
      const t = toInt(r.t);
      const o = Number(r.o);
      const h = Number(r.h);
      const l = Number(r.l);
      const c = Number(r.c);
      const v = Number(r.v);
      if (t == null || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(v)) {
        continue;
      }
      rows.push({
        symbol,
        date: new Date(t).toISOString().slice(0, 10),
        open: o,
        high: h,
        low: l,
        close: c,
        volume: Math.round(v),
        source: "polygon",
      });
    }

    if (rows.length === 0) {
      failed.push({ symbol, error: "No valid rows parsed from Polygon response" });
      continue;
    }

    const { error: upErr } = await supabase.from("price_bars").upsert(rows, {
      onConflict: "symbol,date",
    });

    if (upErr) {
      failed.push({ symbol, error: `Upsert failed: ${upErr.message}` });
      continue;
    }
    symbolsSucceeded += 1;
    totalRowsUpserted += rows.length;
  }

  return NextResponse.json({
    ok: true,
    universe_slug: universeSlug,
    offset,
    limit,
    symbols_attempted: symbols.length,
    symbols_succeeded: symbolsSucceeded,
    total_rows_upserted: totalRowsUpserted,
    failed,
    duration_ms: Date.now() - startedAt,
  });
}
