import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getBrokerReadOnlySnapshot } from "@/lib/broker/read_only_sync";

export async function GET() {
  try {
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
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const snapshot = await getBrokerReadOnlySnapshot();
    return NextResponse.json({
      ok: true,
      user_id: user.id,
      broker: snapshot,
      safeguards: {
        execution_enabled: false,
        read_only_only: true,
        scanner_influence: false,
        strategy_influence: false,
        note: "Phase 1 broker groundwork: read-only scaffold only.",
      },
      rollout: {
        phase_1: "account/positions sync (read-only)",
        phase_2: "paper execution module",
        phase_3: "live execution module",
      },
    });
  } catch (e: unknown) {
    const error =
      e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
