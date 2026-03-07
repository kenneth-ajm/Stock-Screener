import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { makeScanEngineClient } from "@/lib/scan_engine";
import { runDerivedScanBackfill } from "@/lib/backfill_derived_scans";

type Body = {
  start_date?: string;
  end_date?: string;
  strategies?: string[];
  dry_run?: boolean;
  execute?: boolean;
  max_days?: number;
  include_breadth_preview?: boolean;
};

function clampMaxDays(input: unknown) {
  const n = Number(input);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(30, Math.floor(n)));
}

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
    const max_days = clampMaxDays(body.max_days);
    const execute = body.execute === true;
    if (execute && max_days > 10) {
      return NextResponse.json(
        {
          ok: false,
          error: "Execution guard: max_days > 10 is blocked for this route. Use <= 10.",
        },
        { status: 400 }
      );
    }

    const supabase = makeScanEngineClient();
    const summary = await runDerivedScanBackfill({
      supabase,
      input: {
        start_date,
        end_date,
        strategies: Array.isArray(body.strategies) ? body.strategies : undefined,
        dry_run: body.dry_run,
        execute,
        max_days,
        include_breadth_preview: body.include_breadth_preview,
      },
    });

    return NextResponse.json({
      ...summary,
      safety: {
        execute,
        max_days,
        note: execute
          ? "Execute mode writes derived rows only; no raw price ingestion."
          : "Dry-run only. No rows were written.",
      },
    });
  } catch (e: unknown) {
    console.error("backfill-derived-scans error", e);
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

