import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const ALLOWED_STATUSES = new Set(["PENDING", "OPEN", "CLOSED", "STOPPED", "TP1_HIT", "TP2_HIT"]);
const CLOSED_STATUSES = new Set(["CLOSED", "STOPPED", "TP1_HIT", "TP2_HIT"]);

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "").trim();
  const status = String(body?.status ?? "").trim().toUpperCase();
  const notes = body?.notes == null ? null : String(body.notes);
  const exitPrice = body?.exit_price == null || body?.exit_price === "" ? null : Number(body.exit_price);

  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
  }
  if (exitPrice !== null && (!Number.isFinite(exitPrice) || exitPrice <= 0)) {
    return NextResponse.json({ ok: false, error: "exit_price invalid" }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (notes !== null) updatePayload.notes = notes;
  if (exitPrice !== null) updatePayload.exit_price = exitPrice;
  if (CLOSED_STATUSES.has(status)) {
    updatePayload.closed_at = new Date().toISOString();
  } else {
    updatePayload.closed_at = null;
    updatePayload.exit_price = null;
  }

  const { data, error } = await supabase
    .from("paper_positions")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        hint: /paper_positions/i.test(error.message)
          ? "Run docs/SQL/2026-03-08_paper_execution.sql in Supabase."
          : null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, position: data });
}

