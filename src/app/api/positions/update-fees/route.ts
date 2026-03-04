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

  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const positionId = String(body?.position_id ?? "").trim();
  const entryFeeRaw = body?.entry_fee;
  const exitFeeRaw = body?.exit_fee;
  const entryFee = entryFeeRaw == null || entryFeeRaw === "" ? null : Number(entryFeeRaw);
  const exitFee = exitFeeRaw == null || exitFeeRaw === "" ? null : Number(exitFeeRaw);

  if (!positionId) {
    return NextResponse.json({ ok: false, error: "position_id is required" }, { status: 400 });
  }
  if (entryFee !== null && (!Number.isFinite(entryFee) || entryFee < 0)) {
    return NextResponse.json({ ok: false, error: "entry_fee must be >= 0" }, { status: 400 });
  }
  if (exitFee !== null && (!Number.isFinite(exitFee) || exitFee < 0)) {
    return NextResponse.json({ ok: false, error: "exit_fee must be >= 0" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("portfolio_positions")
    .update({
      entry_fee: entryFee,
      exit_fee: exitFee,
    })
    .eq("id", positionId)
    .eq("user_id", user.id)
    .select("id, entry_fee, exit_fee")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, position: updated });
}
