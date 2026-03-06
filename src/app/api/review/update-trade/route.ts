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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
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
  const id = String(body?.id ?? "").trim();
  const exitReason = body?.exit_reason == null ? null : String(body.exit_reason).trim() || null;
  const notes = body?.notes == null ? null : String(body.notes).trim() || null;

  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("portfolio_positions")
    .update({
      exit_reason: exitReason,
      notes,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "CLOSED")
    .select("id, exit_reason, notes")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Trade not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, trade: updated });
}

