import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type PolygonNewsItem = {
  id?: string;
  title?: string;
  article_url?: string;
  published_utc?: string;
  description?: string;
  summary?: string;
  author?: string;
  publisher?: {
    name?: string;
    homepage_url?: string;
    logo_url?: string;
    favicon_url?: string;
  } | null;
};

async function fetchTickerNews(symbol: string, apiKey: string) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym || !apiKey) return [];
  const url = `https://api.polygon.io/v2/reference/news?ticker=${encodeURIComponent(sym)}&limit=5&order=desc&sort=published_utc&apiKey=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const results = Array.isArray(json?.results) ? (json.results as PolygonNewsItem[]) : [];
    return results.map((item) => ({
      id: item?.id ? String(item.id) : null,
      title: item?.title ? String(item.title) : null,
      article_url: item?.article_url ? String(item.article_url) : null,
      published_utc: item?.published_utc ? String(item.published_utc) : null,
      description: item?.description ? String(item.description) : item?.summary ? String(item.summary) : null,
      author: item?.author ? String(item.author) : null,
      publisher_name: item?.publisher?.name ? String(item.publisher.name) : null,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

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

    const symbol = String(new URL(req.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (!symbol) return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });

    const apiKey = process.env.POLYGON_API_KEY ?? "";
    const news = await fetchTickerNews(symbol, apiKey);
    return NextResponse.json({ ok: true, news });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    const detail = e instanceof Error ? e.stack ?? null : null;
    return NextResponse.json({ ok: false, error, detail }, { status: 500 });
  }
}
