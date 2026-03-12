import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Legacy endpoint (Stooq source).
// Kept only for emergency/testing compatibility.
// Production source of truth is Polygon; this route is disabled by default.
const LEGACY_STOOQ_ENABLED = process.env.ENABLE_LEGACY_STOOQ_INGEST === "1";

function stooqSymbol(symbol: string) {
  return `${symbol.toLowerCase()}.us`;
}

type StooqRow = {
  symbol: string;
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // integer
  source: string;
};

function toNumberSafe(x: string) {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

function toIntSafe(x: string) {
  // Stooq sometimes returns volumes with decimals; DB expects bigint
  const n = Number(x);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
}

async function fetchStooqDaily(symbol: string): Promise<StooqRow[]> {
  const s = stooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;

  // simple retry for transient failures / rate limit hiccups
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      let hint = "";
      try {
        hint = (await res.text()).slice(0, 120);
      } catch {}

      if (attempt === 2) {
        throw new Error(
          `Stooq fetch failed for ${symbol} (${s}). HTTP ${res.status}. ${hint}`
        );
      }

      // wait briefly then retry
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length <= 1) return [];

    const rows: StooqRow[] = [];

    for (const line of lines.slice(1)) {
      if (!line) continue;

      const [date, open, high, low, close, volume] = line.split(",");

      const o = toNumberSafe(open);
      const h = toNumberSafe(high);
      const l = toNumberSafe(low);
      const c = toNumberSafe(close);
      const v = toIntSafe(volume);

      // skip malformed rows safely
      if (!date || [o, h, l, c, v].some((n) => !Number.isFinite(n))) {
        continue;
      }

      rows.push({
        symbol,
        date,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
        source: "stooq",
      });
    }

    return rows;
  }

  return [];
}

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

  // Pull active tickers for core_400
  const { data: members, error: memErr } = await supabase
    .from("universe_members")
    .select("symbol, active, universe_id, universes!inner(slug)")
    .eq("universes.slug", "core_400")
    .eq("active", true);

  if (memErr) {
    return NextResponse.json(
      { ok: false, error: memErr.message },
      { status: 500 }
    );
  }

  const symbols = (members ?? []).map((m: any) => String(m.symbol).toUpperCase());
  if (symbols.length === 0) {
    return NextResponse.json({ ok: false, error: "No symbols in core_400" });
  }

  const results: { symbol: string; inserted: number; error?: string }[] = [];

  for (const symbol of symbols) {
    try {
      const rows = await fetchStooqDaily(symbol);

      if (rows.length === 0) {
        results.push({ symbol, inserted: 0, error: "No rows returned" });
        continue;
      }

      const { error: upsertErr } = await supabase
        .from("price_bars")
        .upsert(rows, { onConflict: "symbol,date" });

      if (upsertErr) {
        results.push({ symbol, inserted: 0, error: upsertErr.message });
        continue;
      }

      results.push({ symbol, inserted: rows.length });
    } catch (e: any) {
      results.push({ symbol, inserted: 0, error: e?.message ?? "Unknown error" });
    }
  }

  const insertedTotal = results.reduce((sum, r) => sum + r.inserted, 0);

  return NextResponse.json({
    ok: true,
    deprecated: true,
    provider: "stooq",
    universe: "core_400",
    symbols: symbols.length,
    insertedTotal,
    results,
  });
}
