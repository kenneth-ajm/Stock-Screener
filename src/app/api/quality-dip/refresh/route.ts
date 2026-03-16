import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { QUALITY_DIP_WATCHLIST } from "@/lib/quality_dip_watchlist";

export const dynamic = "force-dynamic";

type RefreshResult = {
  symbol: string;
  ok: boolean;
  rows_upserted: number;
  latest_bar_date: string | null;
  error?: string;
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isAuthorized(req: Request) {
  const expected = process.env.ADMIN_RUN_SCAN_KEY;
  if (!expected) return true;
  const provided = req.headers.get("x-admin-key");
  return Boolean(provided && provided === expected);
}

async function fetchAggs(symbol: string, apiKey: string, from: string, to: string) {
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/1/day/${from}/${to}?adjusted=false&sort=asc&limit=50000&apiKey=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Polygon ${res.status}: ${detail.slice(0, 160)}`);
    }
    const json = (await res.json().catch(() => null)) as { results?: Array<Record<string, unknown>> } | null;
    return Array.isArray(json?.results) ? json.results : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshSymbol(opts: {
  supabase: any;
  apiKey: string;
  symbol: string;
  from: string;
  to: string;
}): Promise<RefreshResult> {
  try {
    const results = await fetchAggs(opts.symbol, opts.apiKey, opts.from, opts.to);
    const rows = results
      .map((r) => {
        const t = Number(r.t);
        const open = Number(r.o);
        const high = Number(r.h);
        const low = Number(r.l);
        const close = Number(r.c);
        const volume = Number(r.v);
        if (
          !Number.isFinite(t) ||
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close) ||
          !Number.isFinite(volume)
        ) {
          return null;
        }
        return {
          symbol: opts.symbol,
          date: new Date(t).toISOString().slice(0, 10),
          open,
          high,
          low,
          close,
          volume: Math.round(volume),
          source: "polygon",
        };
      })
      .filter(Boolean) as Array<{
      symbol: string;
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      source: string;
    }>;

    if (rows.length === 0) {
      return {
        symbol: opts.symbol,
        ok: false,
        rows_upserted: 0,
        latest_bar_date: null,
        error: "No valid daily bars returned",
      };
    }

    const { error } = await opts.supabase.from("price_bars").upsert(rows, { onConflict: "symbol,date" });
    if (error) {
      return {
        symbol: opts.symbol,
        ok: false,
        rows_upserted: 0,
        latest_bar_date: null,
        error: error.message,
      };
    }

    return {
      symbol: opts.symbol,
      ok: true,
      rows_upserted: rows.length,
      latest_bar_date: rows[rows.length - 1]?.date ?? null,
    };
  } catch (error: any) {
    return {
      symbol: opts.symbol,
      ok: false,
      rows_upserted: 0,
      latest_bar_date: null,
      error: String(error?.message ?? "Refresh failed"),
    };
  }
}

async function runInBatches<T, R>(items: T[], batchSize: number, worker: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.all(batch.map((item) => worker(item)));
    out.push(...settled);
  }
  return out;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized: invalid x-admin-key" }, { status: 401 });
  }

  const apiKey = process.env.POLYGON_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Missing Supabase environment" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey) as any;
  const symbols = Array.from(new Set(["SPY", ...QUALITY_DIP_WATCHLIST.map((item) => item.symbol)]));
  const from = isoDate(daysAgo(420));
  const to = isoDate(new Date());

  const results = await runInBatches(symbols, 6, async (symbol) =>
    refreshSymbol({ supabase, apiKey, symbol, from, to })
  );

  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const latestBarDate =
    successes
      .map((result) => result.latest_bar_date)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] ?? null;
  const spyDate = results.find((result) => result.symbol === "SPY")?.latest_bar_date ?? null;

  return NextResponse.json({
    ok: failures.length === 0,
    status: failures.length === 0 ? "refresh complete" : "refresh completed with gaps",
    mode: "quality_dip_watchlist",
    bars_source: "polygon_daily",
    symbols_attempted: symbols.length,
    symbols_succeeded: successes.length,
    symbols_failed: failures.length,
    rows_upserted: successes.reduce((sum, result) => sum + result.rows_upserted, 0),
    expected_market_date: spyDate,
    latest_bar_date: latestBarDate,
    from,
    to,
    duration_ms: Date.now() - startedAt,
    failures: failures.map((result) => ({
      symbol: result.symbol,
      error: result.error ?? "Unknown refresh failure",
    })),
  });
}
