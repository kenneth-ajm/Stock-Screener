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

  if (!user)
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  const entry = Number(body.entry_price);
  const stop = Number(body.stop_price);
  const qty = Number(body.quantity);

  if (!symbol || !Number.isFinite(entry) || entry <= 0)
    return NextResponse.json({ ok: false, error: "Invalid symbol or entry price" });

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
    status: "OPEN",
  });

  if (error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}