import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

async function runRepair() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  let repaired_user_id_rows_count = 0;

  const { count: userPortfolioCount, error: countErr } = await supabase
    .from("portfolios")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countErr) return NextResponse.json({ ok: false, error: countErr.message }, { status: 500 });

  if (Number(userPortfolioCount ?? 0) === 0) {
    const { data: orphanCandidate, error: orphanErr } = await supabase
      .from("portfolios")
      .select("id")
      .is("user_id", null)
      .or("is_default.eq.true,active.eq.true")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (orphanErr) return NextResponse.json({ ok: false, error: orphanErr.message }, { status: 500 });
    if (orphanCandidate?.id) {
      const claim = await supabase
        .from("portfolios")
        .update({ user_id: user.id })
        .eq("id", orphanCandidate.id)
        .is("user_id", null)
        .select("id");
      if (claim.error) return NextResponse.json({ ok: false, error: claim.error.message }, { status: 500 });
      repaired_user_id_rows_count += (claim.data ?? []).length;
    }
  }

  const { data: defaultRow, error: defaultErr } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (defaultErr) return NextResponse.json({ ok: false, error: defaultErr.message }, { status: 500 });

  let defaultPortfolioId = defaultRow?.id ?? null;
  if (!defaultPortfolioId) {
    const { data: firstPortfolio, error: firstErr } = await supabase
      .from("portfolios")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstErr) return NextResponse.json({ ok: false, error: firstErr.message }, { status: 500 });
    if (!firstPortfolio?.id) {
      return NextResponse.json({ ok: false, error: "No portfolios found for user" }, { status: 404 });
    }

    const setDefault = await supabase
      .from("portfolios")
      .update({ is_default: true })
      .eq("id", firstPortfolio.id)
      .eq("user_id", user.id);
    if (setDefault.error) {
      return NextResponse.json({ ok: false, error: setDefault.error.message }, { status: 500 });
    }
    defaultPortfolioId = firstPortfolio.id;
  }

  const unsetOthers = await supabase
    .from("portfolios")
    .update({ is_default: false })
    .eq("user_id", user.id)
    .neq("id", defaultPortfolioId);
  if (unsetOthers.error) {
    return NextResponse.json({ ok: false, error: unsetOthers.error.message }, { status: 500 });
  }

  const ensureDefault = await supabase
    .from("portfolios")
    .update({ is_default: true })
    .eq("id", defaultPortfolioId)
    .eq("user_id", user.id);
  if (ensureDefault.error) {
    return NextResponse.json({ ok: false, error: ensureDefault.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user_id: user.id,
    default_portfolio_id: defaultPortfolioId,
    repaired_user_id_rows_count,
  });
}

export async function GET() {
  return runRepair();
}

export async function POST() {
  return runRepair();
}

