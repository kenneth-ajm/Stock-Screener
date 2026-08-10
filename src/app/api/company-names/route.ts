import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getCompanyReferences } from "@/lib/company_reference";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  try {
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

    const symbols = String(new URL(req.url).searchParams.get("symbols") ?? "")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => /^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol))
      .slice(0, 60);
    if (symbols.length === 0) return NextResponse.json({ ok: true, names: {}, source: "polygon_reference_cache" });

    const references = await getCompanyReferences(symbols);
    const names = Object.fromEntries(
      references.filter((row) => row.name).map((row) => [row.symbol, row.name])
    );
    return NextResponse.json({ ok: true, names, source: "polygon_reference_cache" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Company reference lookup failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
