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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const portfolioId = String(body?.portfolio_id ?? "").trim();
  if (!portfolioId) return NextResponse.json({ ok: false, error: "portfolio_id is required" }, { status: 400 });

  // read portfolio
  const { data: portfolio, error: readErr } = await supabase
    .from("portfolios")
    .select("id, is_default")
    .eq("id", portfolioId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!portfolio) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  // block if open positions exist
  const { data: openCount, error: countErr } = await supabase
    .from("portfolio_positions")
    .select("id", { count: "exact", head: true })
    .eq("portfolio_id", portfolioId)
    .eq("status", "OPEN");

  if (countErr) return NextResponse.json({ ok: false, error: countErr.message }, { status: 500 });
  const cnt = (openCount as any)?.length; // head:true usually returns null data; we only need count, but Supabase JS varies
  // safer: just try a small fetch
  const { data: openAny } = await supabase
    .from("portfolio_positions")
    .select("id")
    .eq("portfolio_id", portfolioId)
    .eq("status", "OPEN")
    .limit(1);

  if (openAny && openAny.length > 0) {
    return NextResponse.json({ ok: false, error: "Cannot delete: portfolio has OPEN positions" }, { status: 400 });
  }

  // delete
  const { error: delErr } = await supabase
    .from("portfolios")
    .delete()
    .eq("id", portfolioId)
    .eq("user_id", user.id);

  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });

  // if it was default, pick another as default
  if (portfolio.is_default) {
    const { data: remaining } = await supabase
      .from("portfolios")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1);

    if (remaining && remaining.length > 0) {
      await supabase.from("portfolios").update({ is_default: true }).eq("id", remaining[0].id).eq("user_id", user.id);
    }
  }

  return NextResponse.json({ ok: true });
}