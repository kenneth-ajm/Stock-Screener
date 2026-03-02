import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function previousWeekday(from: Date) {
  const d = new Date(from);
  // step back until Mon-Fri
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

type GroupedRow = {
  T: string; // ticker
  c: number; // close
  v: number; // volume
};

export async function POST(req: Request) {
  const apiKey = process.env.POLYGON_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing POLYGON_API_KEY" }, { status: 500 });
  if (!supabaseUrl || !serviceKey)
    return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 });

  const supabase = createClient(supabaseUrl, serviceKey);

  const body = await req.json().catch(() => ({}));
  const targetDate = typeof body?.date === "string" && body.date ? body.date : isoDate(previousWeekday(new Date()));

  // price band preferences
  const minPrice = typeof body?.min_price === "number" ? body.min_price : 5;
  const maxPrice = typeof body?.max_price === "number" ? body.max_price : 30;
  const limit = typeof body?.limit === "number" ? Math.max(100, Math.min(5000, body.limit)) : 2000;

  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(
    targetDate
  )}?adjusted=false&apiKey=${apiKey}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return NextResponse.json(
      { ok: false, error: `Polygon grouped failed (${res.status})`, detail: txt.slice(0, 200) },
      { status: 500 }
    );
  }

  const json = await res.json().catch(() => null);
  const results: GroupedRow[] = Array.isArray(json?.results) ? json.results : [];

  if (!results.length) {
    return NextResponse.json({ ok: false, error: "No grouped results returned" }, { status: 500 });
  }

  // Filter + rank by dollar volume (c * v)
  const ranked = results
    .map((r) => {
      const sym = (r.T ?? "").toUpperCase();
      const close = Number(r.c);
      const vol = Number(r.v);
      const dollarVol = close > 0 && vol > 0 ? close * vol : 0;
      return { sym, close, vol, dollarVol };
    })
    .filter((x) => x.sym && x.close >= minPrice && x.close <= maxPrice && x.vol > 0 && x.dollarVol > 0)
    .sort((a, b) => b.dollarVol - a.dollarVol)
    .slice(0, limit);

  if (!ranked.length) {
    return NextResponse.json({
      ok: false,
      error: "No symbols matched the filters (price band / liquidity). Try widening max_price.",
      date: targetDate,
      minPrice,
      maxPrice,
    });
  }

  // Ensure universe exists
  const universeSlug = "liquid_2000";

  const { data: existingUniverse } = await supabase
    .from("universes")
    .select("id, slug")
    .eq("slug", universeSlug)
    .maybeSingle();

  let universeId = existingUniverse?.id ?? null;

  if (!universeId) {
    const { data: created, error: uErr } = await supabase
      .from("universes")
      .insert({ slug: universeSlug, name: `Liquid ${limit} ($${minPrice}–$${maxPrice})` })
      .select("id")
      .maybeSingle();

    if (uErr || !created?.id) {
      return NextResponse.json({ ok: false, error: uErr?.message || "Failed to create universe" }, { status: 500 });
    }
    universeId = created.id;
  } else {
    // Update name to reflect filters (optional)
    await supabase
      .from("universes")
      .update({ name: `Liquid ${limit} ($${minPrice}–$${maxPrice})` })
      .eq("id", universeId);
  }

  // Deactivate old members first (so universe updates cleanly)
  await supabase.from("universe_members").update({ active: false }).eq("universe_id", universeId);

  const memberRows = ranked.map((x) => ({
    universe_id: universeId,
    symbol: x.sym,
    active: true,
  }));

  // Upsert members (assumes unique on universe_id + symbol)
  const { error: mErr } = await supabase.from("universe_members").upsert(memberRows, {
    onConflict: "universe_id,symbol",
  });

  if (mErr) {
    return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    universe_slug: universeSlug,
    universe_id: universeId,
    date: targetDate,
    min_price: minPrice,
    max_price: maxPrice,
    count: ranked.length,
    top10: ranked.slice(0, 10),
  });
}