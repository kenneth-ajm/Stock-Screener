import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().trim();
  const date = (url.searchParams.get("date") ?? "").trim();
  const universe = (url.searchParams.get("universe") ?? "core_800").trim();
  const version = (url.searchParams.get("version") ?? "v2_core_momentum").trim();

  if (!symbol || !date) {
    return NextResponse.json(
      { ok: false, error: "symbol and date are required" },
      { status: 400 }
    );
  }

  const { data: row, error } = await supabase
    .from("daily_scans")
    .select("symbol, signal, confidence, reason_summary, reason_json")
    .eq("symbol", symbol)
    .eq("date", date)
    .eq("universe_slug", universe)
    .eq("strategy_version", version)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "No explanation found for that symbol/date" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, row });
}

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
  const symbol = String(body?.symbol ?? "").toUpperCase().trim();
  const date = String(body?.date ?? "").trim();
  const universe = String(body?.universe_slug ?? body?.universe ?? "core_800").trim();
  const version = String(body?.strategy_version ?? body?.version ?? "v2_core_momentum").trim();

  if (!symbol || !date) {
    return NextResponse.json(
      { ok: false, error: "symbol and date are required" },
      { status: 400 }
    );
  }

  const { data: row, error } = await supabase
    .from("daily_scans")
    .select("symbol, signal, confidence, reason_summary, reason_json")
    .eq("symbol", symbol)
    .eq("date", date)
    .eq("universe_slug", universe)
    .eq("strategy_version", version)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "No explanation found for that symbol/date" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, row });
}
