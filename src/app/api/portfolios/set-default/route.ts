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
  const portfolioId = String(body?.portfolio_id ?? "").trim();
  if (!portfolioId) {
    return NextResponse.json({ ok: false, error: "portfolio_id is required" }, { status: 400 });
  }

  const { data: targetPortfolio, error: targetErr } = await supabase
    .from("portfolios")
    .select("id,user_id")
    .eq("id", portfolioId)
    .limit(1)
    .maybeSingle();
  if (targetErr) {
    return NextResponse.json({ ok: false, error: targetErr.message }, { status: 500 });
  }
  if (!targetPortfolio?.id) {
    return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });
  }
  if (targetPortfolio.user_id && String(targetPortfolio.user_id) !== user.id) {
    return NextResponse.json({ ok: false, error: "Portfolio not found for current user" }, { status: 404 });
  }

  const { error: unsetErr } = await supabase
    .from("portfolios")
    .update({ is_default: false })
    .eq("user_id", user.id);
  if (unsetErr) {
    return NextResponse.json({ ok: false, error: unsetErr.message }, { status: 500 });
  }

  const { data: setRows, error: setErr } = await supabase
    .from("portfolios")
    .update({ is_default: true, user_id: user.id })
    .eq("id", portfolioId)
    .select("id")
    .limit(1);
  if (setErr) {
    return NextResponse.json({ ok: false, error: setErr.message }, { status: 500 });
  }
  if (!setRows || setRows.length === 0) {
    return NextResponse.json({ ok: false, error: "Portfolio not found for current user" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, default_portfolio_id: setRows[0].id });
}
