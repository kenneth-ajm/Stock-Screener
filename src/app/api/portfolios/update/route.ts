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

  const patch: any = {};

  if (body?.name != null) patch.name = String(body.name).trim();
  if (body?.account_currency != null) patch.account_currency = String(body.account_currency).trim();

  if (body?.account_size != null) {
    const v = Number(body.account_size);
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json({ ok: false, error: "account_size must be a positive number" }, { status: 400 });
    }
    patch.account_size = v;
  }

  if (body?.risk_per_trade != null) {
    const v = Number(body.risk_per_trade);
    if (!Number.isFinite(v) || v <= 0 || v > 0.2) {
      return NextResponse.json({ ok: false, error: "risk_per_trade must be decimal like 0.02 (2%), max 0.2" }, { status: 400 });
    }
    patch.risk_per_trade = v;
  }

  if (body?.max_positions != null) {
    const v = Number(body.max_positions);
    if (!Number.isFinite(v) || v <= 0 || v > 100) {
      return NextResponse.json({ ok: false, error: "max_positions must be between 1 and 100" }, { status: 400 });
    }
    patch.max_positions = v;
  }

  const { data, error } = await supabase
    .from("portfolios")
    .update(patch)
    .eq("id", portfolioId)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  return NextResponse.json({ ok: true, portfolio: data });
}