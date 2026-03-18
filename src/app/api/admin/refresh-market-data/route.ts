import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { runWorkflow } from "@/app/api/jobs/daily-scheduled-scan/route";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
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

    const payload = await runWorkflow({
      dry_run: false,
      trigger: {
        source: "authenticated_manual_refresh",
        user_id: user.id,
      },
    });

    return NextResponse.json(payload, { status: payload.ok ? 200 : 500 });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
