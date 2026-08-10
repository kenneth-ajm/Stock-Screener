import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { QUALITY_DIP_WATCHLIST } from "@/lib/quality_dip_watchlist";
import { getMarketDataProvider, type MarketDataProvider } from "@/lib/market-data";
import { latestCompletedUsTradingDay, shiftIsoDate } from "@/lib/market-calendar";

export const dynamic = "force-dynamic";

type RefreshResult = {
  symbol: string;
  ok: boolean;
  rows_upserted: number;
  latest_bar_date: string | null;
  error?: string;
};

function isAuthorized(req: Request) {
  const expected = process.env.ADMIN_RUN_SCAN_KEY;
  if (!expected) return true;
  const provided = req.headers.get("x-admin-key");
  return Boolean(provided && provided === expected);
}

async function refreshSymbol(opts: {
  supabase: SupabaseClient;
  provider: MarketDataProvider;
  symbol: string;
  from: string;
  to: string;
}): Promise<RefreshResult> {
  try {
    const result = await opts.provider.fetchDailyBars(opts.symbol, opts.from, opts.to);
    const rows = result.bars.map((bar) => ({
      ...bar,
      source: opts.provider.id,
    }));

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
      latest_bar_date: rows.at(-1)?.date ?? null,
    };
  } catch (error: unknown) {
    return {
      symbol: opts.symbol,
      ok: false,
      rows_upserted: 0,
      latest_bar_date: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runInBatches<T, R>(items: T[], batchSize: number, worker: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Missing Supabase environment" }, { status: 500 });
  }

  const provider = getMarketDataProvider();
  if (!provider.configured) {
    return NextResponse.json(
      { ok: false, error: `${provider.label} market data is not configured`, provider: provider.id },
      { status: 503 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const symbols = Array.from(new Set(["SPY", ...QUALITY_DIP_WATCHLIST.map((item) => item.symbol)]));
  const to = latestCompletedUsTradingDay();
  const from = shiftIsoDate(to, -420);

  const results = await runInBatches(symbols, 6, async (symbol) =>
    refreshSymbol({ supabase, provider, symbol, from, to })
  );

  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const latestBarDate =
    successes
      .map((result) => result.latest_bar_date)
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ?? null;
  const spyDate = results.find((result) => result.symbol === "SPY")?.latest_bar_date ?? null;

  return NextResponse.json({
    ok: failures.length === 0,
    status: failures.length === 0 ? "refresh complete" : "refresh completed with gaps",
    mode: "quality_dip_watchlist",
    market_data_provider: provider.id,
    bars_source: `${provider.id}_daily`,
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
