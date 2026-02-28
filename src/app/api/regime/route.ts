import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function calculateSMA(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export async function GET() {
  return NextResponse.json({
    ok: false,
    message: "Use POST. Go to /screener and click 'Calculate SPY Regime'.",
  });
}

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: bars, error } = await supabase
    .from("price_bars")
    .select("date, close")
    .eq("symbol", "SPY")
    .order("date", { ascending: true });

  if (error || !bars) {
    return NextResponse.json(
      { ok: false, error: error?.message || "No SPY data" },
      { status: 500 }
    );
  }

  const closes = bars.map((b) => Number(b.close));
  const sma200 = calculateSMA(closes, 200);

  if (!sma200) {
    return NextResponse.json(
      { ok: false, error: "Not enough data for SMA200" },
      { status: 400 }
    );
  }

  const latest = bars[bars.length - 1];
  const latestClose = Number(latest.close);
  const state = latestClose > sma200 ? "FAVORABLE" : "DEFENSIVE";

  const { error: upsertErr } = await supabase.from("market_regime").upsert({
    date: latest.date,
    symbol: "SPY",
    close: latestClose,
    sma200,
    state,
  });

  if (upsertErr) {
    return NextResponse.json(
      { ok: false, error: upsertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    date: latest.date,
    latest_close: latestClose,
    sma200,
    state,
  });
}