import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
    return NextResponse.json({ ok: false, error: "tp1_pct must be > 0" }, { status: 400 });
  }
  if (tpPlan === "tp1_tp2" && (!Number.isFinite(tp2Pct) || Number(tp2Pct) <= 0)) {
    return NextResponse.json({ ok: false, error: "tp2_pct must be > 0" }, { status: 400 });
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

  const { data: updated, error } = await supabase
    .from("portfolio_positions")
    .update({
      tp_plan: tpPlan,
      tp1_pct: tpPlan === "none" ? null : tp1Pct,
      tp2_pct: tpPlan === "tp1_tp2" ? tp2Pct : null,
      tp1_size_pct: finalTp1SizePct,
      tp2_size_pct: finalTp2SizePct,
    })
    .eq("id", positionId)
    .eq("user_id", user.id)
    .eq("status", "OPEN")
    .select("id,tp_plan,tp1_pct,tp2_pct,tp1_size_pct,tp2_size_pct")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: "Open position not found" }, { status: 404 });

  return NextResponse.json({ ok: true, position: updated });
}
