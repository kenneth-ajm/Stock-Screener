import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getBuildMarker, getEnvironmentLabel } from "@/lib/build_marker";

export const dynamic = "force-dynamic";

async function latestScanStats(supabase: any, strategyVersion: string, universeSlug: string) {
  const { data: latest } = await supabase
    .from("daily_scans")
    .select("date")
    .eq("strategy_version", strategyVersion)
    .eq("universe_slug", universeSlug)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const date = latest?.date ? String(latest.date) : null;
  if (!date) {
    return {
      strategy_version: strategyVersion,
      universe_slug: universeSlug,
      latest_date: null,
      latest_date_rows: 0,
    };
  }
  const { count } = await supabase
    .from("daily_scans")
    .select("id", { head: true, count: "exact" })
    .eq("strategy_version", strategyVersion)
    .eq("universe_slug", universeSlug)
    .eq("date", date);
  return {
    strategy_version: strategyVersion,
    universe_slug: universeSlug,
    latest_date: date,
    latest_date_rows: Number(count ?? 0),
  };
}

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const [momentum, trend, sector] = await Promise.all([
      latestScanStats(supabase as any, "v2_core_momentum", "core_800"),
      latestScanStats(supabase as any, "v1_trend_hold", "core_800"),
      latestScanStats(supabase as any, "v1_sector_momentum", "growth_1500"),
    ]);

    const { data: defaultPortfolio } = await (supabase as any)
      .from("portfolios")
      .select("id,name,is_default,user_id,account_size,cash_balance")
      .eq("user_id", user.id)
      .eq("is_default", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const brokerStatusKey = `broker_snapshot_last_run:${user.id}`;
    const { data: brokerStatus } = await (supabase as any)
      .from("system_status")
      .select("updated_at,value")
      .eq("key", brokerStatusKey)
      .maybeSingle();
    const brokerValue = (brokerStatus?.value ?? null) as any;
    const brokerConnected = Boolean(brokerValue?.connection_ok);
    const defaultName = String(defaultPortfolio?.name ?? "").trim().toLowerCase();
    const mode = defaultName === "main" && brokerConnected ? "broker_linked" : "manual";
    const modeReason =
      mode === "broker_linked"
        ? "Default portfolio is Main and broker snapshot is connected."
        : defaultName !== "main"
          ? "Default portfolio is not Main."
          : "Main selected but broker snapshot disconnected/missing.";

    return NextResponse.json({
      ok: true,
      runtime: {
        build_marker: getBuildMarker(),
        environment: getEnvironmentLabel(),
        vercel_region: process.env.VERCEL_REGION ?? null,
      },
      user_id: user.id,
      ideas_strategies: {
        momentum,
        trend,
        sector,
      },
      broker: {
        snapshot_key: brokerStatusKey,
        latest_snapshot_timestamp: brokerStatus?.updated_at ?? null,
        connected: brokerConnected,
        positions_count: Number(brokerValue?.positions_count ?? 0),
      },
      default_portfolio: defaultPortfolio
        ? {
            id: String(defaultPortfolio.id),
            name: String(defaultPortfolio.name ?? ""),
            is_default: Boolean(defaultPortfolio.is_default),
            account_size: Number(defaultPortfolio.account_size ?? 0),
            cash_balance: defaultPortfolio.cash_balance ?? null,
          }
        : null,
      workspace_source_resolution: {
        mode,
        reason: modeReason,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
