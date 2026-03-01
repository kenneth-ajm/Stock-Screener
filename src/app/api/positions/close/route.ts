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
  const positionId = String(body?.position_id ?? "").trim();

  // ✅ Require exit_price for proper closed-history + P/L
  const exitPriceRaw = body?.exit_price;
  const exitPrice = Number(exitPriceRaw);

  if (!positionId) {
    return NextResponse.json({ ok: false, error: "position_id is required" }, { status: 400 });
  }

  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return NextResponse.json(
      { ok: false, error: "exit_price is required and must be a positive number" },
      { status: 400 }
    );
  }

  // Optional safety: only close OPEN positions
  const { data: existing, error: readErr } = await supabase
    .from("portfolio_positions")
    .select("id, status")
    .eq("id", positionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ ok: false, error: "Position not found" }, { status: 404 });
  }

  if (existing.status !== "OPEN") {
    return NextResponse.json(
      { ok: false, error: "Position is not OPEN" },
      { status: 400 }
    );
  }

  const closedAt = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("portfolio_positions")
    .update({
      status: "CLOSED",
      closed_at: closedAt,
      exit_price: exitPrice,
    })
    .eq("id", positionId)
    .eq("user_id", user.id)
    .select("id, status, closed_at, exit_price")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, position: updated });
}