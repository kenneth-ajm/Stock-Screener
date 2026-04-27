import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MOMENTUM_WATCHLIST_SEED,
  computeMomentumWatchlistRow,
  sortMomentumRows,
  type MomentumPriceBar,
} from "@/lib/momentum-watchlist";

export const dynamic = "force-dynamic";

type PriceBarRecord = {
  date?: string | null;
  open?: number | string | null;
  high?: number | string | null;
  low?: number | string | null;
  close?: number | string | null;
  volume?: number | string | null;
};

function toNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapPriceBar(row: PriceBarRecord): MomentumPriceBar | null {
  const date = typeof row?.date === "string" ? String(row.date) : "";
  const open = toNumber(row?.open);
  const high = toNumber(row?.high);
  const low = toNumber(row?.low);
  const close = toNumber(row?.close);
  const volume = toNumber(row?.volume);
  if (!date || open == null || high == null || low == null || close == null || volume == null) return null;
  return { date, open, high, low, close, volume };
}

async function fetchBarsForSymbol(supabase: SupabaseClient, symbol: string) {
  const { data, error } = await supabase
    .from("price_bars")
    .select("date,open,high,low,close,volume")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(80);

  if (error) throw error;
  const rows = Array.isArray(data) ? (data as PriceBarRecord[]) : [];
  return rows.map(mapPriceBar).filter((bar): bar is MomentumPriceBar => Boolean(bar));
}

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: "Missing Supabase environment" }, { status: 500 });
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const rows = await Promise.all(
      MOMENTUM_WATCHLIST_SEED.map(async (seed) => {
        const bars = await fetchBarsForSymbol(supabase, seed.symbol);
        return computeMomentumWatchlistRow(seed, bars);
      })
    );
    const sortedRows = sortMomentumRows(rows);
    const sourceDates = sortedRows.map((row) => row.sourceDate).filter((date): date is string => Boolean(date)).sort();

    return NextResponse.json({
      ok: true,
      rows: sortedRows,
      meta: {
        mode: "momentum_watchlist",
        universe_name: "momentum_watchlist",
        watchlist_size: MOMENTUM_WATCHLIST_SEED.length,
        source_date: sourceDates[sourceDates.length - 1] ?? null,
        daily_data_only: true,
        horizon: "1-2 day momentum watchlist",
      },
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
