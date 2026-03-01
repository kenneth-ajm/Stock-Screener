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
  const symbol = String(body?.symbol ?? "").toUpperCase().trim();
  const entry_price = Number(body?.entry_price);
  const stop = Number(body?.stop);
  const shares = Number(body?.shares);

  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  if (!Number.isFinite(entry_price) || entry_price <= 0)
    return NextResponse.json({ ok: false, error: "entry_price invalid" }, { status: 400 });
  if (!Number.isFinite(stop) || stop <= 0)
    return NextResponse.json({ ok: false, error: "stop invalid" }, { status: 400 });
  if (!Number.isFinite(shares) || shares <= 0)
    return NextResponse.json({ ok: false, error: "shares invalid" }, { status: 400 });

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
      status: "OPEN",
    })
    .select("id")
    .single();

  if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: inserted.id });
}