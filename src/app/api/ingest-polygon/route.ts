import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Polygon maintenance ingest bridge (legacy core_400 scope).
// Keep for controlled maintenance/backfill use; production daily refresh is daily-autopilot.
// ---- helpers ----
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url: string, tries = 3) {
  let lastErr: any = null;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        // ignore parse error
      }

      if (!res.ok) {
        // handle rate-limit nicely
        if (res.status === 429 && i < tries) {
          await sleep(600 * i);
          continue;
        }
        throw new Error(
          `HTTP ${res.status} ${res.statusText}. ${text.slice(0, 120)}`
        );
      }

      return json;
    } catch (e) {
      lastErr = e;
      if (i < tries) await sleep(400 * i);
    }
  }
  throw lastErr;
}

// ---- main ----
export async function GET() {
  return NextResponse.json({
    ok: false,
    message:
      "Use POST. This ingests daily OHLCV from Polygon into price_bars for SPY + core_400 members.",
  });
}

export async function POST() {
  const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
  if (!POLYGON_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Missing POLYGON_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // pull active core_400 symbols (your test 10 for now)
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

  const symbols = Array.from(
    new Set(
      ["SPY", ...(members ?? []).map((m: any) => String(m.symbol).toUpperCase())]
    )
  );

  // backfill window: enough for SMA200 + buffer
  const from = isoDate(daysAgo(320));
  const to = isoDate(new Date());

  const results: Array<{ symbol: string; inserted: number; error?: string }> =
    [];

  for (const symbol of symbols) {
    try {
      // Polygon aggregates range endpoint (daily bars)
      // adjusted=false => NOT adjusted for splits (raw trading prices)
      const url =
        `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
          symbol
        )}/range/1/day/${from}/${to}` +
        `?adjusted=false&sort=asc&limit=50000&apiKey=${encodeURIComponent(
          POLYGON_API_KEY
        )}`;

      const json = await fetchJsonWithRetry(url, 3);

      const rows =
        (json?.results ?? []).map((r: any) => {
          // Polygon agg fields:
          // t = timestamp ms, o/h/l/c/v = OHLCV
          const date = isoDate(new Date(Number(r.t)));
          return {
            symbol,
            date,
            open: Number(r.o),
            high: Number(r.h),
            low: Number(r.l),
            close: Number(r.c),
            volume: Math.round(Number(r.v ?? 0)),
            source: "polygon",
          };
        }) ?? [];

      if (!rows.length) {
        results.push({ symbol, inserted: 0, error: "No rows returned" });
        continue;
      }

      // sanity: reject clearly broken values
      const cleaned = rows.filter((x: any) => {
        const ok =
          Number.isFinite(x.open) &&
          Number.isFinite(x.high) &&
          Number.isFinite(x.low) &&
          Number.isFinite(x.close) &&
          x.close > 0 &&
          x.high >= x.low &&
          x.high > 0;
        return ok;
      });

      const { error: upErr } = await supabase
        .from("price_bars")
        .upsert(cleaned, { onConflict: "symbol,date" });

      if (upErr) {
        results.push({ symbol, inserted: 0, error: upErr.message });
        continue;
      }

      results.push({ symbol, inserted: cleaned.length });

      // tiny throttle to be kind to API limits
      await sleep(180);
    } catch (e: any) {
      results.push({
        symbol,
        inserted: 0,
        error: e?.message ?? "Unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    from,
    to,
    symbols: symbols.length,
    results,
  });
}
