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

  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const positionId = String(body?.position_id ?? "").trim();
  const tpPlanRaw = String(body?.tp_plan ?? "none").trim().toLowerCase();
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

  if (!positionId) {
    return NextResponse.json({ ok: false, error: "position_id is required" }, { status: 400 });
  }
  if (!tpPlan) {
    return NextResponse.json({ ok: false, error: "tp_plan must be none | tp1_only | tp1_tp2" }, { status: 400 });
  }
  if (tpPlan !== "none" && (!Number.isFinite(tp1Pct) || Number(tp1Pct) <= 0)) {
    if (tp1Price == null) return NextResponse.json({ ok: false, error: "tp1_pct or tp1_price must be > 0" }, { status: 400 });
  }
  if (tpPlan === "tp1_tp2" && (!Number.isFinite(tp2Pct) || Number(tp2Pct) <= 0)) {
    if (tp2Price == null) return NextResponse.json({ ok: false, error: "tp2_pct or tp2_price must be > 0" }, { status: 400 });
  }
  if (tp1Price !== null && (!Number.isFinite(tp1Price) || Number(tp1Price) <= 0)) {
    return NextResponse.json({ ok: false, error: "tp1_price must be > 0" }, { status: 400 });
  }
  if (tp2Price !== null && (!Number.isFinite(tp2Price) || Number(tp2Price) <= 0)) {
    return NextResponse.json({ ok: false, error: "tp2_price must be > 0" }, { status: 400 });
  }
  if (tpPlan !== "none" && (!Number.isFinite(tp1SizePct) || Number(tp1SizePct) < 0 || Number(tp1SizePct) > 100)) {
    return NextResponse.json({ ok: false, error: "tp1_size_pct must be between 0 and 100" }, { status: 400 });
  }
  if (tpPlan === "tp1_tp2" && (!Number.isFinite(tp2SizePct) || Number(tp2SizePct) < 0 || Number(tp2SizePct) > 100)) {
    return NextResponse.json({ ok: false, error: "tp2_size_pct must be between 0 and 100" }, { status: 400 });
  }
  const finalTp1SizePct =
    tpPlan === "none" ? null : tp1SizePct == null ? (tpPlan === "tp1_only" ? 100 : 50) : tp1SizePct;
  const finalTp2SizePct =
    tpPlan === "tp1_tp2" ? (tp2SizePct == null ? 50 : tp2SizePct) : 0;
  const { data: existing, error: existingErr } = await supabase
    .from("portfolio_positions")
    .select("id,entry_price")
    .eq("id", positionId)
    .eq("user_id", user.id)
    .eq("status", "OPEN")
    .maybeSingle();
  if (existingErr) return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ ok: false, error: "Open position not found" }, { status: 404 });
  const entryPrice = Number(existing.entry_price);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return NextResponse.json({ ok: false, error: "Position entry_price missing" }, { status: 400 });
  }
  const tp1Derived = tpPlan === "none" ? { pct: null as number | null, price: null as number | null } : deriveTp(entryPrice, tp1Pct, tp1Price);
  const tp2Derived =
    tpPlan === "tp1_tp2"
      ? deriveTp(entryPrice, tp2Pct, tp2Price)
      : { pct: null as number | null, price: null as number | null };
  if (tpPlan !== "none" && tp1Derived.pct === null) {
    return NextResponse.json({ ok: false, error: "tp1_pct or tp1_price required" }, { status: 400 });
  }
  if (tpPlan === "tp1_tp2" && tp2Derived.pct === null) {
    return NextResponse.json({ ok: false, error: "tp2_pct or tp2_price required" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("portfolio_positions")
    .update({
      tp_plan: tpPlan,
      tp1_pct: tp1Derived.pct,
      tp2_pct: tp2Derived.pct,
      tp1_price: tp1Derived.price,
      tp2_price: tp2Derived.price,
      tp1_size_pct: finalTp1SizePct,
      tp2_size_pct: finalTp2SizePct,
    })
    .eq("id", positionId)
    .eq("user_id", user.id)
    .eq("status", "OPEN")
    .select("id,tp_plan,tp1_pct,tp2_pct,tp1_price,tp2_price,tp1_size_pct,tp2_size_pct")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, position: updated });
}
