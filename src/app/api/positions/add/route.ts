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
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const symbol = String(body?.symbol ?? "").toUpperCase().trim();
  const entry_price = Number(body?.entry_price);
  const stopRaw = body?.stop ?? body?.stop_price;
  const stop = Number(stopRaw);
  const shares = Number(body?.shares);
  const strategy_version = String(body?.strategy_version ?? "v2_core_momentum").trim() || "v2_core_momentum";
  const max_hold_days_raw = body?.max_hold_days;
  const max_hold_days =
    max_hold_days_raw == null || max_hold_days_raw === ""
      ? null
      : Math.max(1, Math.floor(Number(max_hold_days_raw)));
  const tp_model = body?.tp_model == null ? null : String(body.tp_model);
  const tp_plan_raw = body?.tp_plan == null ? "" : String(body.tp_plan).trim().toLowerCase();
  const tp_plan =
    tp_plan_raw === "none" ||
    tp_plan_raw === "tp1_only" ||
    tp_plan_raw === "tp1_tp2"
      ? tp_plan_raw
      : null;
  const tp1_pct_raw = body?.tp1_pct;
  const tp2_pct_raw = body?.tp2_pct;
  const tp1_size_pct_raw = body?.tp1_size_pct;
  const tp2_size_pct_raw = body?.tp2_size_pct;
  const tp1_price_raw = body?.tp1_price;
  const tp2_price_raw = body?.tp2_price;
  const entry_fee_raw = body?.entry_fee;
  const tp1_pct = tp1_pct_raw == null || tp1_pct_raw === "" ? null : Number(tp1_pct_raw);
  const tp2_pct = tp2_pct_raw == null || tp2_pct_raw === "" ? null : Number(tp2_pct_raw);
  const tp1_size_pct =
    tp1_size_pct_raw == null || tp1_size_pct_raw === "" ? null : Math.round(Number(tp1_size_pct_raw));
  const tp2_size_pct =
    tp2_size_pct_raw == null || tp2_size_pct_raw === "" ? null : Math.round(Number(tp2_size_pct_raw));
  const tp1_price = tp1_price_raw == null || tp1_price_raw === "" ? null : Number(tp1_price_raw);
  const tp2_price = tp2_price_raw == null || tp2_price_raw === "" ? null : Number(tp2_price_raw);
  const entry_fee = entry_fee_raw == null || entry_fee_raw === "" ? null : Number(entry_fee_raw);

  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  if (!Number.isFinite(entry_price) || entry_price <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "entry_price invalid",
        detail: {
          received: { entry_price: body?.entry_price, stop: stopRaw, shares: body?.shares },
          rule: "entry_price must be > 0",
        },
      },
      { status: 400 }
    );
  }
  if (!Number.isFinite(stop) || stop <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "stop invalid",
        detail: {
          received: { entry_price, stop: stopRaw, shares: body?.shares },
          rule: "stop (or stop_price) must be > 0",
        },
      },
      { status: 400 }
    );
  }
  if (entry_price <= stop) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid trade: entry_price must be greater than stop",
        detail: {
          received: { entry_price, stop, shares: body?.shares },
          rule: "entry_price > stop",
        },
      },
      { status: 400 }
    );
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "shares invalid",
        detail: {
          received: { entry_price, stop, shares: body?.shares },
          rule: "shares must be > 0",
        },
      },
      { status: 400 }
    );
  }
  if (max_hold_days !== null && !Number.isFinite(max_hold_days)) {
    return NextResponse.json(
      {
        ok: false,
        error: "max_hold_days invalid",
        detail: {
          received: { max_hold_days: max_hold_days_raw },
          rule: "max_hold_days must be a positive integer when provided",
        },
      },
      { status: 400 }
    );
  }
  if (tp_plan_raw && !tp_plan) {
    return NextResponse.json(
      {
        ok: false,
        error: "tp_plan invalid",
        detail: {
          received: { tp_plan: tp_plan_raw },
          rule: "tp_plan must be none | tp1_only | tp1_tp2",
        },
      },
      { status: 400 }
    );
  }
  if (tp1_pct !== null && (!Number.isFinite(tp1_pct) || tp1_pct <= 0)) {
    return NextResponse.json(
      { ok: false, error: "TP1 must be above entry (percent > 0)" },
      { status: 400 }
    );
  }
  if (tp2_pct !== null && (!Number.isFinite(tp2_pct) || tp2_pct <= 0)) {
    return NextResponse.json(
      {
        ok: false,
        error: "tp2_pct invalid",
        detail: {
          received: { tp2_pct: tp2_pct_raw },
          rule: "tp2_pct must be > 0 when provided",
        },
      },
      { status: 400 }
    );
  }
  if (tp1_price !== null && (!Number.isFinite(tp1_price) || tp1_price <= 0)) {
    return NextResponse.json(
      {
        ok: false,
        error: "tp1_price invalid",
        detail: {
          received: { tp1_price: tp1_price_raw },
          rule: "tp1_price must be > 0 when provided",
        },
      },
      { status: 400 }
    );
  }
  if (tp2_price !== null && (!Number.isFinite(tp2_price) || tp2_price <= 0)) {
    return NextResponse.json(
      {
        ok: false,
        error: "tp2_price invalid",
        detail: {
          received: { tp2_price: tp2_price_raw },
          rule: "tp2_price must be > 0 when provided",
        },
      },
      { status: 400 }
    );
  }
  if (entry_fee !== null && (!Number.isFinite(entry_fee) || entry_fee < 0)) {
    return NextResponse.json(
      {
        ok: false,
        error: "entry_fee invalid",
        detail: {
          received: { entry_fee: entry_fee_raw },
          rule: "entry_fee must be >= 0 when provided",
        },
      },
      { status: 400 }
    );
  }
  if (
    tp1_size_pct !== null &&
    (!Number.isFinite(tp1_size_pct) || tp1_size_pct < 0 || tp1_size_pct > 100)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "tp1_size_pct invalid",
        detail: {
          received: { tp1_size_pct: tp1_size_pct_raw },
          rule: "tp1_size_pct must be between 0 and 100",
        },
      },
      { status: 400 }
    );
  }
  if (
    tp2_size_pct !== null &&
    (!Number.isFinite(tp2_size_pct) || tp2_size_pct < 0 || tp2_size_pct > 100)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "tp2_size_pct invalid",
        detail: {
          received: { tp2_size_pct: tp2_size_pct_raw },
          rule: "tp2_size_pct must be between 0 and 100",
        },
      },
      { status: 400 }
    );
  }
  const normalizedTpPlan =
    tp_plan === "tp1_only"
      ? "tp1_only"
      : tp_plan === "tp1_tp2"
        ? "tp1_tp2"
      : "none";
  const tp1Derived =
    normalizedTpPlan === "none" ? { pct: null as number | null, price: null as number | null } : deriveTp(entry_price, tp1_pct, tp1_price);
  const tp2Derived =
    normalizedTpPlan === "tp1_tp2"
      ? deriveTp(entry_price, tp2_pct, tp2_price)
      : { pct: null as number | null, price: null as number | null };
  const finalTp1Pct = tp1Derived.pct;
  const finalTp2Pct = tp2Derived.pct;
  const finalTp1Price = tp1Derived.price;
  const finalTp2Price = tp2Derived.price;
  const finalTp1SizePct =
    normalizedTpPlan === "none"
      ? null
      : tp1_size_pct == null
        ? normalizedTpPlan === "tp1_only"
          ? 100
          : 50
        : tp1_size_pct;
  const finalTp2SizePct =
    normalizedTpPlan === "tp1_tp2"
      ? tp2_size_pct == null
        ? 50
        : tp2_size_pct
      : 0;

  if ((normalizedTpPlan === "tp1_only" || normalizedTpPlan === "tp1_tp2") && finalTp1Pct === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "tp1_pct required",
        detail: {
          received: { tp_plan, tp1_pct: tp1_pct_raw, tp1_price: tp1_price_raw },
          rule: "tp1_pct or tp1_price is required for tp1_only or tp1_tp2",
        },
      },
      { status: 400 }
    );
  }
  if ((normalizedTpPlan === "tp1_only" || normalizedTpPlan === "tp1_tp2") && finalTp1Pct !== null && finalTp1Pct <= 0) {
    return NextResponse.json(
      { ok: false, error: "TP1 must be above entry (percent > 0)" },
      { status: 400 }
    );
  }
  if (normalizedTpPlan === "tp1_tp2" && finalTp2Pct === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "tp2_pct required",
        detail: {
          received: { tp_plan, tp2_pct: tp2_pct_raw, tp2_price: tp2_price_raw },
          rule: "tp2_pct or tp2_price is required for tp1_tp2",
        },
      },
      { status: 400 }
    );
  }

  // default portfolio
  const { data: portfolio, error: pErr } = await supabase
    .from("portfolios")
    .select("id, max_positions")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle();

  if (pErr || !portfolio) {
    return NextResponse.json({ ok: false, error: pErr?.message || "No default portfolio" }, { status: 500 });
  }

  // max open positions enforcement
  const { count, error: cErr } = await supabase
    .from("portfolio_positions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("portfolio_id", portfolio.id)
    .eq("status", "OPEN");

  if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });

  if ((count ?? 0) >= Number(portfolio.max_positions)) {
    return NextResponse.json(
      { ok: false, error: `Max open positions reached (${portfolio.max_positions}). Close one before adding.` },
      { status: 400 }
    );
  }

  const entry_date = new Date().toISOString().slice(0, 10);

  const { data: inserted, error: insErr } = await supabase
    .from("portfolio_positions")
    .insert({
      user_id: user.id,
      portfolio_id: portfolio.id,
      symbol,
      entry_date,
      entry_price,
      shares,
      stop,
      strategy_version,
      max_hold_days,
      tp_model,
      tp_plan: normalizedTpPlan,
      tp1_pct: finalTp1Pct,
      tp2_pct: finalTp2Pct,
      tp1_price: finalTp1Price,
      tp2_price: finalTp2Price,
      tp1_size_pct: finalTp1SizePct,
      tp2_size_pct: finalTp2SizePct,
      entry_fee,
      status: "OPEN",
    })
    .select("id")
    .single();

  if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: inserted.id });
}
