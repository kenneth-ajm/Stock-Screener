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

  // 1) clear defaults
  const { error: clearErr } = await supabase
    .from("portfolios")
    .update({ is_default: false })
    .eq("user_id", user.id);

  if (clearErr) return NextResponse.json({ ok: false, error: clearErr.message }, { status: 500 });

  // 2) set selected
  const { data, error } = await supabase
    .from("portfolios")
    .update({ is_default: true })
    .eq("id", portfolioId)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  return NextResponse.json({ ok: true, portfolio: data });
}