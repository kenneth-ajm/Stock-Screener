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
  const symbolRaw = String(body?.symbol ?? "").trim();
  const symbolUpper = symbolRaw.toUpperCase();

  if (!portfolioId) {
    return NextResponse.json({ ok: false, error: "portfolio_id is required" }, { status: 400 });
  }
  if (!symbolUpper) {
    return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
  }

  const { data: portfolio, error: portfolioErr } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (portfolioErr) {
    return NextResponse.json({ ok: false, error: portfolioErr.message }, { status: 500 });
  }
  if (!portfolio?.id) {
    return NextResponse.json({ ok: false, error: "Portfolio not found for current user" }, { status: 404 });
  }

  const { data: openRows, error: readErr } = await supabase
    .from("portfolio_positions")
    .select("id,symbol,status")
    .eq("user_id", user.id)
    .eq("portfolio_id", portfolioId)
    .eq("status", "OPEN");
  if (readErr) {
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }

  const targetIds = (openRows ?? [])
    .filter((row: any) => String(row?.symbol ?? "").toUpperCase() === symbolUpper)
    .map((row: any) => row.id)
    .filter(Boolean);
  if (targetIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: `No OPEN lots found for ${symbolUpper}` },
      { status: 404 }
    );
  }

  const closedAt = new Date().toISOString();
  const exitDate = closedAt.slice(0, 10);

  const { data: updated, error: closeErr } = await supabase
    .from("portfolio_positions")
    .update({
      status: "CLOSED",
      closed_at: closedAt,
      exit_price: null,
      exit_reason: "MANUAL",
      exit_date: exitDate,
    })
    .in("id", targetIds)
    .eq("user_id", user.id)
    .select("id");
  if (closeErr) {
    return NextResponse.json({ ok: false, error: closeErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    portfolio_id: portfolioId,
    symbol: symbolUpper,
    closed_count: Array.isArray(updated) ? updated.length : 0,
  });
}
