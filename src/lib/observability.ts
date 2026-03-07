import { createClient } from "@supabase/supabase-js";
import { CORE_MOMENTUM_DEFAULT_UNIVERSE, CORE_MOMENTUM_DEFAULT_VERSION } from "@/lib/strategy/coreMomentumSwing";
import { TREND_HOLD_DEFAULT_VERSION } from "@/lib/strategy/trendHold";
import { SECTOR_MOMENTUM_STRATEGY_VERSION, SECTOR_MOMENTUM_UNIVERSE_SLUG } from "@/lib/sector_momentum";
import { getLCTD } from "@/lib/scan_status";

export const OBS_KEYS = {
  replay: "derived_replay_last_run",
  sector: "sector_momentum_last_run",
  rescan: "rescan_latest_last_run",
  autopilot: "daily_autopilot_core_800",
  backtest: "backtest_last_run",
} as const;

export function makeObservabilityClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } }) as any;
}

export async function writeObservabilityStatus(opts: {
  supabase?: any;
  key: string;
  value: Record<string, unknown>;
}) {
  const supa = (opts.supabase ?? makeObservabilityClient()) as any;
  const payload = {
    key: opts.key,
    value: opts.value,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supa.from("system_status").upsert(payload, { onConflict: "key" });
  if (error) throw error;
}

async function latestForStrategy(supa: any, strategy_version: string, universe_slug: string) {
  const { data: latestRow } = await supa
    .from("daily_scans")
    .select("date")
    .eq("strategy_version", strategy_version)
    .eq("universe_slug", universe_slug)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latest_date = latestRow?.date ? String(latestRow.date) : null;
  if (!latest_date) {
    return {
      strategy_version,
      universe_slug,
      latest_date: null,
      total: 0,
      buy: 0,
      watch: 0,
      avoid: 0,
    };
  }

  const { data: rows } = await supa
    .from("daily_scans")
    .select("signal")
    .eq("strategy_version", strategy_version)
    .eq("universe_slug", universe_slug)
    .eq("date", latest_date)
    .limit(5000);

  let buy = 0;
  let watch = 0;
  let avoid = 0;
  for (const row of rows ?? []) {
    const signal = String((row as any)?.signal ?? "").toUpperCase();
    if (signal === "BUY") buy += 1;
    else if (signal === "WATCH") watch += 1;
    else avoid += 1;
  }
  return {
    strategy_version,
    universe_slug,
    latest_date,
    total: (rows ?? []).length,
    buy,
    watch,
    avoid,
  };
}

export async function getObservabilitySnapshot(supabase?: any) {
  const supa = (supabase ?? makeObservabilityClient()) as any;
  const lctd = await getLCTD(supa);

  const strategies = [
    { strategy_version: CORE_MOMENTUM_DEFAULT_VERSION, universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE },
    { strategy_version: TREND_HOLD_DEFAULT_VERSION, universe_slug: CORE_MOMENTUM_DEFAULT_UNIVERSE },
    { strategy_version: SECTOR_MOMENTUM_STRATEGY_VERSION, universe_slug: SECTOR_MOMENTUM_UNIVERSE_SLUG },
  ];
  const latest_scans = [];
  for (const s of strategies) {
    latest_scans.push(await latestForStrategy(supa, s.strategy_version, s.universe_slug));
  }

  const keys = Object.values(OBS_KEYS);
  const { data: statuses } = await supa.from("system_status").select("key,updated_at,value").in("key", keys);
  const statusMap = new Map<string, any>();
  for (const row of statuses ?? []) {
    statusMap.set(String((row as any)?.key ?? ""), {
      updated_at: (row as any)?.updated_at ?? null,
      value: (row as any)?.value ?? null,
    });
  }

  const sectorLatest = latest_scans.find((s) => s.strategy_version === SECTOR_MOMENTUM_STRATEGY_VERSION);
  const momentumLatest = latest_scans.find((s) => s.strategy_version === CORE_MOMENTUM_DEFAULT_VERSION);
  const trendLatest = latest_scans.find((s) => s.strategy_version === TREND_HOLD_DEFAULT_VERSION);
  const latest_scan_date = latest_scans
    .map((s) => s.latest_date)
    .filter((d): d is string => Boolean(d))
    .sort()
    .slice(-1)[0] ?? null;

  return {
    ok: true,
    lctd: lctd.lctd,
    lctd_source: lctd.source,
    latest_scan_date,
    latest_replay_run_date: String(statusMap.get(OBS_KEYS.replay)?.value?.end_date ?? statusMap.get(OBS_KEYS.replay)?.value?.start_date ?? "") || null,
    latest_breadth_computation_date:
      String(statusMap.get(OBS_KEYS.sector)?.value?.scan_date_used ?? statusMap.get(OBS_KEYS.autopilot)?.value?.date_used ?? "") || null,
    latest_sector_ranking_computation_date:
      String(statusMap.get(OBS_KEYS.sector)?.value?.scan_date_used ?? sectorLatest?.latest_date ?? "") || null,
    runs: {
      autopilot: statusMap.get(OBS_KEYS.autopilot) ?? null,
      rescan: statusMap.get(OBS_KEYS.rescan) ?? null,
      replay: statusMap.get(OBS_KEYS.replay) ?? null,
      sector: statusMap.get(OBS_KEYS.sector) ?? null,
      backtest: statusMap.get(OBS_KEYS.backtest) ?? null,
    },
    scans: {
      momentum: momentumLatest ?? null,
      trend: trendLatest ?? null,
      sector: sectorLatest ?? null,
    },
  };
}
