import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { closeGroupedSymbol } from "@/lib/positions/close_position";

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
  const exitPrice = Number(body?.exit_price);
  const exitFeeRaw = body?.exit_fee;
  const exitFee = exitFeeRaw == null || exitFeeRaw === "" ? null : Number(exitFeeRaw);
  const exitReason = String(body?.exit_reason ?? "MANUAL").trim().toUpperCase();
  const closeQuantity = Number(body?.close_quantity);
  const allowedReasons = new Set(["TP1", "TP2", "STOP", "MANUAL", "TIME"]);

  if (!portfolioId) {
    return NextResponse.json({ ok: false, error: "portfolio_id is required" }, { status: 400 });
  }
  if (!symbolUpper) {
    return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return NextResponse.json({ ok: false, error: "exit_price is required and must be > 0" }, { status: 400 });
  }
  if (exitFee !== null && (!Number.isFinite(exitFee) || exitFee < 0)) {
    return NextResponse.json({ ok: false, error: "exit_fee is invalid (must be >= 0)" }, { status: 400 });
  }
  if (!allowedReasons.has(exitReason)) {
    return NextResponse.json({ ok: false, error: "Invalid exit_reason" }, { status: 400 });
  }
  if (!Number.isFinite(closeQuantity) || closeQuantity <= 0) {
    return NextResponse.json({ ok: false, error: "close_quantity is required and must be > 0" }, { status: 400 });
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

  try {
    const result = await closeGroupedSymbol({
      supabase,
      userId: user.id,
      portfolioId,
      symbol: symbolUpper,
      exitPrice,
      exitFee,
      exitReason,
      closeQuantity,
    });
    return NextResponse.json({
      ok: true,
      portfolio_id: portfolioId,
      symbol: symbolUpper,
      mode: result.mode,
      closed_count: result.closed_count,
      closed_quantity: result.closed_quantity,
      remaining_quantity: result.remaining_quantity,
    });
  } catch (error: any) {
    const message = String(error?.message ?? "Close symbol failed");
    const status =
      /not found/i.test(message) ? 404 :
      /positive number|exceeds open quantity|invalid/i.test(message) ? 400 :
      500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
