import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  return NextResponse.json({
    ok: false,
    message:
      "This endpoint requires POST. Go to /screener and click the 'Ingest SPY data' button.",
  });
}

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const res = await fetch("https://stooq.com/q/d/l/?s=spy.us&i=d", {
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch Stooq data" },
      { status: 500 }
    );
  }

  const text = await res.text();

  const rows = text
    .trim()
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [date, open, high, low, close, volume] = line.split(",");
      return {
        symbol: "SPY",
        date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
        source: "stooq",
      };
    });

  const { error } = await supabase
    .from("price_bars")
    .upsert(rows, { onConflict: "symbol,date" });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: rows.length });
}