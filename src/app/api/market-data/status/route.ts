import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  getMarketDataProvider,
  getMarketDataProviderInfo,
  getMarketQuoteProvider,
  getMarketQuoteProviderInfo,
} from "@/lib/market-data";
import { latestCompletedUsTradingDay, marketSessionsBehind } from "@/lib/market-calendar";
import { OBS_KEYS } from "@/lib/observability";

export const dynamic = "force-dynamic";

async function authenticated() {
  const cookieStore = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => undefined,
      },
    }
  );
  const { data } = await client.auth.getUser();
  return Boolean(data.user);
}

export async function GET(req: Request) {
  if (!(await authenticated())) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Missing Supabase environment" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const [{ data: spyRows }, { data: globalRows }, { data: scheduler }] = await Promise.all([
    supabase.from("price_bars").select("date,source").eq("symbol", "SPY").eq("source", "polygon").order("date", { ascending: false }).limit(1),
    supabase.from("price_bars").select("date,source").eq("source", "polygon").order("date", { ascending: false }).limit(1),
    supabase.from("system_status").select("updated_at,value").eq("key", OBS_KEYS.scheduler).maybeSingle(),
  ]);

  const providerInfo = getMarketDataProviderInfo();
  const quoteProviderInfo = getMarketQuoteProviderInfo();
  const latestSpyDate = spyRows?.[0]?.date ? String(spyRows[0].date) : null;
  const latestGlobalDate = globalRows?.[0]?.date ? String(globalRows[0].date) : null;
  const expectedDate = latestCompletedUsTradingDay();
  const sessionsBehind = marketSessionsBehind(latestSpyDate, expectedDate);
  const probeRequested = new URL(req.url).searchParams.get("probe") === "1";
  const probe = probeRequested && providerInfo.configured ? await getMarketDataProvider().probe() : null;
  let quoteProbe: { ok: boolean; provider: string; checked_at: string; as_of: string | null; error: string | null } | null = null;
  if (probeRequested) {
    const checkedAt = new Date().toISOString();
    if (!quoteProviderInfo.configured) {
      quoteProbe = { ok: false, provider: quoteProviderInfo.id, checked_at: checkedAt, as_of: null, error: "Quote provider is not configured" };
    } else {
      try {
        const quote = await getMarketQuoteProvider().fetchLatestQuote("SPY");
        quoteProbe = {
          ok: Boolean(quote),
          provider: quoteProviderInfo.id,
          checked_at: checkedAt,
          as_of: quote?.as_of ?? null,
          error: quote ? null : "No SPY quote returned",
        };
      } catch (error: unknown) {
        quoteProbe = {
          ok: false,
          provider: quoteProviderInfo.id,
          checked_at: checkedAt,
          as_of: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    provider: providerInfo,
    quote_provider: quoteProviderInfo,
    cache: {
      expected_completed_session: expectedDate,
      latest_spy_date: latestSpyDate,
      latest_spy_source: spyRows?.[0]?.source ? String(spyRows[0].source) : null,
      latest_global_date: latestGlobalDate,
      latest_global_source: globalRows?.[0]?.source ? String(globalRows[0].source) : null,
      sessions_behind: sessionsBehind,
      state: latestSpyDate === expectedDate ? "current" : latestSpyDate ? "stale" : "unavailable",
    },
    scheduler: scheduler
      ? {
          updated_at: scheduler.updated_at ?? null,
          ok: scheduler.value?.ok === true,
          scan_date: scheduler.value?.scan_date_used ?? null,
          error: scheduler.value?.error ?? null,
        }
      : null,
    probe,
    quote_probe: quoteProbe,
  });
}
