import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { closeSinglePosition } from "@/lib/positions/close_position";

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
  const exitReason = String(body?.exit_reason ?? "MANUAL").trim().toUpperCase();
  const allowedReasons = new Set(["TP1", "TP2", "STOP", "MANUAL", "TIME"]);

  // ✅ Require exit_price for proper closed-history + P/L
  const exitPriceRaw = body?.exit_price;
  const exitPrice = Number(exitPriceRaw);
  const exitFeeRaw = body?.exit_fee;
  const exitFee = exitFeeRaw == null || exitFeeRaw === "" ? null : Number(exitFeeRaw);
  const closeQuantityRaw = body?.close_quantity;
  const closeQuantity = Number(closeQuantityRaw);

  if (!positionId) {
    return NextResponse.json({ ok: false, error: "position_id is required" }, { status: 400 });
  }

  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return NextResponse.json(
      { ok: false, error: "exit_price is required and must be a positive number" },
      { status: 400 }
    );
  }
  if (exitFee !== null && (!Number.isFinite(exitFee) || exitFee < 0)) {
    return NextResponse.json(
      { ok: false, error: "exit_fee is invalid (must be >= 0)" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(closeQuantity) || closeQuantity <= 0) {
    return NextResponse.json(
      { ok: false, error: "close_quantity is required and must be a positive number" },
      { status: 400 }
    );
  }

  if (!allowedReasons.has(exitReason)) {
    return NextResponse.json(
      {
        ok: false,
        error: "exit_reason must be one of TP1, TP2, STOP, MANUAL, TIME",
        received: exitReason || null,
      },
      { status: 400 }
    );
  }

  try {
    const result = await closeSinglePosition({
      supabase,
      userId: user.id,
      positionId,
      exitPrice,
      exitFee,
      exitReason,
      closeQuantity,
    });
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      closed_count: result.closed_count,
      closed_quantity: result.closed_quantity,
      remaining_quantity: result.remaining_quantity,
      position: result.position,
    });
  } catch (error: any) {
    const message = String(error?.message ?? "Close failed");
    const status =
      /not found/i.test(message) ? 404 :
      /not open|exceeds open quantity|positive number|invalid/i.test(message) ? 400 :
      500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
