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
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const account_size = Number(body?.account_size);
  const risk_per_trade = Number(body?.risk_per_trade);
  const max_positions = Number(body?.max_positions);
  const account_currency = String(body?.account_currency ?? "USD").trim() || "USD";

  if (!name) {
    return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
  }
  if (!Number.isFinite(account_size) || account_size <= 0) {
    return NextResponse.json({ ok: false, error: "Account size must be > 0" }, { status: 400 });
  }
  if (!Number.isFinite(risk_per_trade) || risk_per_trade <= 0 || risk_per_trade >= 0.05) {
    return NextResponse.json(
      { ok: false, error: "Risk per trade must be between 0 and 0.05 (e.g. 0.005 for 0.5%)" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(max_positions) || max_positions < 1 || max_positions > 20) {
    return NextResponse.json({ ok: false, error: "Max positions must be 1–20" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("portfolios")
    .insert({
      user_id: user.id,
      name,
      account_currency,
      account_size,
      risk_per_trade,
      max_positions,
      is_default: false,
    })
    .select("id, name, is_default")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, portfolio: data });
}