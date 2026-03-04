import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const key = String(url.searchParams.get("key") ?? "").trim();
    if (!key) {
      return NextResponse.json({ ok: false, error: "key is required" }, { status: 400 });
    }

    const supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ) as any;

    const { data, error } = await supa
      .from("system_status")
      .select("key,updated_at,value")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      status: data
        ? {
            key: data.key ?? key,
            updated_at: data.updated_at ?? null,
            value: data.value ?? null,
          }
        : null,
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}

