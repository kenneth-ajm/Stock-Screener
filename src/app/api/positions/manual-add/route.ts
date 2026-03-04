import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function deriveTp(entry: number, pctRaw: number | null, priceRaw: number | null) {
  const pct = pctRaw !== null && Number.isFinite(pctRaw) && pctRaw > 0 ? pctRaw : null;
  const price = priceRaw !== null && Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null;
  if (pct !== null && price !== null) return { pct: round2(pct), price: round2(price) };
  if (pct !== null) return { pct: round2(pct), price: round2(entry * (1 + pct / 100)) };
  if (price !== null) return { pct: round2(((price - entry) / entry) * 100), price: round2(price) };
  return { pct: null, price: null };
}

export async function POST(req: Request) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) =>
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          ),
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user)
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  const entry = Number(body.entry_price);
  const stop = Number(body.stop_price);
  const qty = Number(body.quantity);
  const tpPlanRaw = String(body.tp_plan ?? "none").trim().toLowerCase();
  const tpPlan =
    tpPlanRaw === "none" || tpPlanRaw === "tp1_only" || tpPlanRaw === "tp1_tp2"
      ? tpPlanRaw
      : null;
  const tp1Pct = body?.tp1_pct == null || body?.tp1_pct === "" ? null : Number(body.tp1_pct);
  const tp2Pct = body?.tp2_pct == null || body?.tp2_pct === "" ? null : Number(body.tp2_pct);
  const tp1Price = body?.tp1_price == null || body?.tp1_price === "" ? null : Number(body.tp1_price);
  const tp2Price = body?.tp2_price == null || body?.tp2_price === "" ? null : Number(body.tp2_price);
  const tp1SizePct =
    body?.tp1_size_pct == null || body?.tp1_size_pct === "" ? null : Math.round(Number(body.tp1_size_pct));
  const tp2SizePct =
    body?.tp2_size_pct == null || body?.tp2_size_pct === "" ? null : Math.round(Number(body.tp2_size_pct));
  const entryFee = body?.entry_fee == null || body?.entry_fee === "" ? null : Number(body.entry_fee);

  if (!symbol || !Number.isFinite(entry) || entry <= 0)
    return NextResponse.json({ ok: false, error: "Invalid symbol or entry price" });
  if (!tpPlan) {
    return NextResponse.json(
      { ok: false, error: "Invalid tp_plan (use none | tp1_only | tp1_tp2)" },
      { status: 400 }
    );
  }
  if (tp1Price !== null && (!Number.isFinite(tp1Price) || Number(tp1Price) <= 0)) {
    return NextResponse.json({ ok: false, error: "Invalid tp1_price" }, { status: 400 });
  }
  if (tp2Price !== null && (!Number.isFinite(tp2Price) || Number(tp2Price) <= 0)) {
    return NextResponse.json({ ok: false, error: "Invalid tp2_price" }, { status: 400 });
  }
  if (tpPlan !== "none" && (!Number.isFinite(tp1SizePct) || Number(tp1SizePct) < 0 || Number(tp1SizePct) > 100)) {
    return NextResponse.json({ ok: false, error: "Invalid tp1_size_pct" }, { status: 400 });
  }
  if (tpPlan === "tp1_tp2" && (!Number.isFinite(tp2SizePct) || Number(tp2SizePct) < 0 || Number(tp2SizePct) > 100)) {
    return NextResponse.json({ ok: false, error: "Invalid tp2_size_pct" }, { status: 400 });
  }
  if (entryFee !== null && (!Number.isFinite(entryFee) || entryFee < 0)) {
    return NextResponse.json({ ok: false, error: "Invalid entry_fee" }, { status: 400 });
  }
  const finalTp1SizePct =
    tpPlan === "none" ? null : tp1SizePct == null ? (tpPlan === "tp1_only" ? 100 : 50) : tp1SizePct;
  const finalTp2SizePct =
    tpPlan === "tp1_tp2" ? (tp2SizePct == null ? 50 : tp2SizePct) : 0;
  const tp1Derived = tpPlan === "none" ? { pct: null as number | null, price: null as number | null } : deriveTp(entry, tp1Pct, tp1Price);
  const tp2Derived =
    tpPlan === "tp1_tp2"
      ? deriveTp(entry, tp2Pct, tp2Price)
      : { pct: null as number | null, price: null as number | null };
  if (tpPlan !== "none" && tp1Derived.pct === null) {
    return NextResponse.json({ ok: false, error: "Invalid tp1: provide tp1_pct or tp1_price" }, { status: 400 });
  }
  if (tpPlan === "tp1_tp2" && tp2Derived.pct === null) {
    return NextResponse.json({ ok: false, error: "Invalid tp2: provide tp2_pct or tp2_price" }, { status: 400 });
  }

  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle();

  if (!portfolio)
    return NextResponse.json({ ok: false, error: "No default portfolio" });

  const { error } = await supabase.from("portfolio_positions").insert({
    portfolio_id: portfolio.id,
    user_id: user.id,
    symbol,
    entry_price: entry,
    stop_price: Number.isFinite(stop) ? stop : null,
    quantity: Number.isFinite(qty) ? qty : null,
    tp_plan: tpPlan,
    tp1_pct: tp1Derived.pct,
    tp2_pct: tp2Derived.pct,
    tp1_price: tp1Derived.price,
    tp2_price: tp2Derived.price,
    tp1_size_pct: finalTp1SizePct,
    tp2_size_pct: finalTp2SizePct,
    entry_fee: entryFee,
    status: "OPEN",
  });

  if (error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
