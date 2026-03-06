import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { makeScanEngineClient } from "@/lib/scan_engine";
import { runMomentumHistoryBackfill } from "@/lib/backfill_momentum_history";

type Body = {
  start_date?: string;
  end_date?: string;
};

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const authClient = createServerClient(
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
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const start_date = String(body.start_date ?? "").slice(0, 10);
    const end_date = String(body.end_date ?? "").slice(0, 10);
    if (!start_date || !end_date) {
      return NextResponse.json({ ok: false, error: "start_date and end_date are required" }, { status: 400 });
    }

    const supabase = makeScanEngineClient();
    const summary = await runMomentumHistoryBackfill({
      supabase,
      input: { start_date, end_date },
    });
    return NextResponse.json(summary);
  } catch (e: unknown) {
    console.error("backfill momentum-history error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

