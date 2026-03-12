import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Legacy endpoint (Stooq source).
// Kept only for emergency/testing compatibility.
// Production source of truth is Polygon; this route is disabled by default.
const LEGACY_STOOQ_ENABLED = process.env.ENABLE_LEGACY_STOOQ_INGEST === "1";

export async function GET() {
  return NextResponse.json({
    ok: false,
    deprecated: true,
    provider: "stooq",
    enabled: LEGACY_STOOQ_ENABLED,
    message: LEGACY_STOOQ_ENABLED
      ? "Legacy endpoint. Use POST only when explicitly required."
      : "Deprecated legacy endpoint. Disabled by default. Set ENABLE_LEGACY_STOOQ_INGEST=1 to enable temporarily.",
  });
}

export async function POST() {
  if (!LEGACY_STOOQ_ENABLED) {
    return NextResponse.json(
      {
        ok: false,
        deprecated: true,
        provider: "stooq",
        error: "Legacy Stooq ingest disabled. Polygon is the production source of truth.",
        hint: "Set ENABLE_LEGACY_STOOQ_INGEST=1 only for temporary maintenance/debug use.",
      },
      { status: 410 }
    );
  }

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

  return NextResponse.json({ ok: true, inserted: rows.length, deprecated: true, provider: "stooq" });
}
