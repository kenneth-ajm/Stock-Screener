import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getOrRepairDefaultPortfolio } from "@/lib/get_or_repair_default_portfolio";

async function runRepair() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const { data: orphanRows, error: orphanErr } = await supabase
    .from("portfolios")
    .select("id")
    .is("user_id", null)
    .eq("is_default", true);
  if (orphanErr) {
    return NextResponse.json({ ok: false, error: orphanErr.message }, { status: 500 });
  }

  let repaired_user_id_rows_count = 0;
  if (Array.isArray(orphanRows) && orphanRows.length > 0) {
    const orphanIds = orphanRows.map((row: any) => row.id).filter(Boolean);
    if (orphanIds.length > 0) {
      const { data: claimedRows, error: claimErr } = await supabase
        .from("portfolios")
        .update({ user_id: user.id, is_default: false })
        .in("id", orphanIds)
        .is("user_id", null)
        .select("id");
      if (claimErr) {
        return NextResponse.json({ ok: false, error: claimErr.message }, { status: 500 });
      }
      repaired_user_id_rows_count = Array.isArray(claimedRows) ? claimedRows.length : 0;
    }
  }

  try {
    const defaultPortfolio = await getOrRepairDefaultPortfolio({
      supabase: supabase as any,
      user_id: user.id,
    });
    if (!defaultPortfolio?.id) {
      return NextResponse.json({ ok: false, error: "Unable to resolve default portfolio" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      default_portfolio_id: defaultPortfolio.id,
      user_id: user.id,
      repaired_user_id_rows_count,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

export async function GET() {
  return runRepair();
}

export async function POST() {
  return runRepair();
}
