import { runScanPipeline, type ScanEngineClient } from "@/lib/scan_engine";
import { defaultUniverseForStrategy, GROWTH_UNIVERSE_SLUG } from "@/lib/strategy_universe";
import { computeMarketBreadth } from "@/lib/market_breadth";
import {
  computeSectorMomentumCandidates,
  SECTOR_MOMENTUM_STRATEGY_VERSION,
} from "@/lib/sector_momentum";

const DEFAULT_STRATEGIES = ["v2_core_momentum", "v1_trend_hold", SECTOR_MOMENTUM_STRATEGY_VERSION];
const DEFAULT_MAX_DAYS = 5;
const MAX_SAFE_DAYS = 130;

export type BackfillDerivedInput = {
  start_date: string;
  end_date: string;
  strategies?: string[];
  dry_run?: boolean;
  execute?: boolean;
  max_days?: number;
  include_breadth_preview?: boolean;
  dedupe_skip_existing?: boolean;
};

export type BackfillDerivedSummary = {
  ok: boolean;
  mode: "dry_run" | "execute";
  start_date: string;
  end_date: string;
  dates_total: number;
  dates_selected: number;
  strategies: string[];
  warnings: string[];
  rows_written: number;
  rows_pruned: number;
  rows_skipped_dedupe: number;
  sample_written: Array<{ date: string; strategy_version: string; universe_slug: string; symbol: string }>;
  sample_skipped_dedupe: Array<{ date: string; strategy_version: string; universe_slug: string; existing_rows: number }>;
  per_strategy: Array<{
    strategy_version: string;
    universe_slug: string;
    dates_processed: number;
    dates_skipped_existing: number;
    rows_written: number;
    rows_pruned: number;
    breadth_preview: Array<{
      date: string;
      pct_above_sma50: number;
      pct_above_sma200: number;
      sample_size: number;
    }>;
    errors: Array<{ date: string; error: string }>;
  }>;
};

function summarizeSectorBreadth(candidates: Array<{ reason_json?: Record<string, unknown> | null }>) {
  let sample = 0;
  let above50 = 0;
  let above200 = 0;
  for (const row of candidates) {
    const checks = Array.isArray((row as any)?.reason_json?.checks) ? (row as any).reason_json.checks : [];
    const c50 = checks.find((c: any) => String(c?.key ?? "") === "close_above_sma50");
    const c200 = checks.find((c: any) => String(c?.key ?? "") === "close_above_sma200");
    if (typeof c50?.ok !== "boolean" && typeof c200?.ok !== "boolean") continue;
    sample += 1;
    if (c50?.ok === true) above50 += 1;
    if (c200?.ok === true) above200 += 1;
  }
  return {
    pct_above_sma50: sample > 0 ? (above50 / sample) * 100 : 0,
    pct_above_sma200: sample > 0 ? (above200 / sample) * 100 : 0,
    sample_size: sample,
  };
}

async function listTradingDays(supa: any, start: string, end: string) {
  const { data: spyDays } = await supa
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });
  const fromSpy: string[] = Array.from(
    new Set((spyDays ?? []).map((d: any) => String(d?.date ?? "")).filter(Boolean))
  );
  if (fromSpy.length > 0) return { dates: fromSpy, source: "spy" as const };

  const { data: anyDays } = await supa
    .from("price_bars")
    .select("date")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true })
    .limit(5000);
  const fromAny: string[] = Array.from(
    new Set((anyDays ?? []).map((d: any) => String(d?.date ?? "")).filter(Boolean))
  );
  return { dates: fromAny, source: "global" as const };
}

export async function runDerivedScanBackfill(opts: {
  supabase: ScanEngineClient;
  input: BackfillDerivedInput;
}): Promise<BackfillDerivedSummary> {
  const supa = opts.supabase as any;
  const start = String(opts.input.start_date ?? "").slice(0, 10);
  const end = String(opts.input.end_date ?? "").slice(0, 10);
  if (!start || !end) throw new Error("start_date and end_date are required");
  if (start > end) throw new Error("start_date must be <= end_date");

  const execute = opts.input.execute === true;
  const dry_run = execute ? false : opts.input.dry_run !== false;
  const mode: "dry_run" | "execute" = dry_run ? "dry_run" : "execute";
  const includeBreadth = opts.input.include_breadth_preview !== false;
  const dedupeSkipExisting = opts.input.dedupe_skip_existing === true;
  const maxDaysRaw = Number(opts.input.max_days ?? DEFAULT_MAX_DAYS);
  const max_days = Math.max(1, Math.min(MAX_SAFE_DAYS, Number.isFinite(maxDaysRaw) ? maxDaysRaw : DEFAULT_MAX_DAYS));
  const strategies = (opts.input.strategies ?? DEFAULT_STRATEGIES)
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);
  if (strategies.length === 0) throw new Error("No strategies provided");

  const days = await listTradingDays(supa, start, end);
  const allDates: string[] = days.dates;
  const selectedDates: string[] = allDates.slice(0, max_days);
  const warnings: string[] = [];
  if (days.source !== "spy") warnings.push("SPY dates unavailable; using global price_bars dates fallback.");
  if (allDates.length > selectedDates.length) {
    warnings.push(`Range capped for safety: selected ${selectedDates.length}/${allDates.length} trading days.`);
  }
  if (!execute) warnings.push("Dry-run mode: no rows written.");

  const summary: BackfillDerivedSummary = {
    ok: true,
    mode,
    start_date: start,
    end_date: end,
    dates_total: allDates.length,
    dates_selected: selectedDates.length,
    strategies,
    warnings,
    rows_written: 0,
    rows_pruned: 0,
    rows_skipped_dedupe: 0,
    sample_written: [],
    sample_skipped_dedupe: [],
    per_strategy: [],
  };

  for (const strategy_version of strategies) {
    const universe_slug = defaultUniverseForStrategy(strategy_version) || "core_800";
    let strategyDates = [...selectedDates];
    const item = {
      strategy_version,
      universe_slug,
      dates_processed: 0,
      dates_skipped_existing: 0,
      rows_written: 0,
      rows_pruned: 0,
      breadth_preview: [] as Array<{
        date: string;
        pct_above_sma50: number;
        pct_above_sma200: number;
        sample_size: number;
      }>,
      errors: [] as Array<{ date: string; error: string }>,
    };

    if (execute && dedupeSkipExisting) {
      const { data: existingRows } = await supa
        .from("daily_scans")
        .select("date")
        .eq("universe_slug", universe_slug)
        .eq("strategy_version", strategy_version)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .limit(250000);
      const dateCounts = new Map<string, number>();
      for (const row of existingRows ?? []) {
        const d = String((row as any)?.date ?? "");
        if (!d) continue;
        dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1);
      }
      strategyDates = allDates.filter((d) => !dateCounts.has(d)).slice(0, max_days);
      item.dates_skipped_existing = allDates.length - strategyDates.length;
      for (const [date, existing_rows] of dateCounts.entries()) {
        summary.rows_skipped_dedupe += existing_rows;
        if (summary.sample_skipped_dedupe.length < 20) {
          summary.sample_skipped_dedupe.push({
            date,
            strategy_version,
            universe_slug,
            existing_rows,
          });
        }
      }
    }

    for (const date of strategyDates) {
      try {
        if (strategy_version === SECTOR_MOMENTUM_STRATEGY_VERSION) {
          const sector = await computeSectorMomentumCandidates({
            supabase: supa,
            scan_date: date,
            universe_slug: GROWTH_UNIVERSE_SLUG,
            top_group_count: 4,
            max_candidates: 12,
          });
          if (!sector.ok) throw new Error(sector.error ?? "sector candidate replay failed");
          const candidates = sector.candidates ?? [];
          if (includeBreadth) {
            item.breadth_preview.push({ date, ...summarizeSectorBreadth(candidates as any[]) });
          }
          if (execute) {
            const rows = candidates.map((c) => ({
              date,
              universe_slug: GROWTH_UNIVERSE_SLUG,
              strategy_version,
              symbol: c.symbol,
              signal: c.signal,
              confidence: Math.round(Number(c.confidence) || 0),
              rank_score: Math.round(Number(c.rank_score) || 0),
              rank: c.rank,
              entry: c.entry,
              stop: c.stop,
              tp1: c.tp1,
              tp2: c.tp2,
              reason_summary: c.reason_summary,
              reason_json: c.reason_json,
              updated_at: new Date().toISOString(),
            }));
            if (rows.length > 0) {
              const { error: upsertErr } = await supa
                .from("daily_scans")
                .upsert(rows, { onConflict: "date,universe_slug,symbol,strategy_version" });
              if (upsertErr) throw upsertErr;
              item.rows_written += rows.length;
              summary.rows_written += rows.length;
            }
            const keep = new Set(rows.map((r) => String(r.symbol ?? "").trim().toUpperCase()).filter(Boolean));
            const { data: existing } = await supa
              .from("daily_scans")
              .select("id,symbol")
              .eq("date", date)
              .eq("universe_slug", GROWTH_UNIVERSE_SLUG)
              .eq("strategy_version", strategy_version);
            const removeIds = (existing ?? [])
              .filter((r: any) => !keep.has(String(r?.symbol ?? "").trim().toUpperCase()))
              .map((r: any) => String(r?.id ?? ""))
              .filter(Boolean);
            for (let i = 0; i < removeIds.length; i += 200) {
              const chunk = removeIds.slice(i, i + 200);
              const { error: delErr } = await supa.from("daily_scans").delete().in("id", chunk);
              if (delErr) throw delErr;
            }
            item.rows_pruned += removeIds.length;
            summary.rows_pruned += removeIds.length;
          }
        } else {
          if (includeBreadth) {
            const breadth = await computeMarketBreadth({
              supabase: supa,
              date,
              universe_slug,
              strategy_version,
              regime_state: null,
            });
            item.breadth_preview.push({
              date,
              pct_above_sma50: breadth.pctAboveSma50,
              pct_above_sma200: breadth.pctAboveSma200,
              sample_size: breadth.sampleSize,
            });
          }
          if (execute) {
            const result = await runScanPipeline({
              supabase: supa,
              universe_slug,
              strategy_version,
              scan_date: date,
              offset: 0,
              limit: 2000,
              finalize: true,
            });
            if (!result.ok) throw new Error(String((result as any).error ?? "scan pipeline failed"));
            const up = Number((result as any).upserted ?? 0);
            item.rows_written += up;
            summary.rows_written += up;
            if (summary.sample_written.length < 20) {
              const { data: writtenRows } = await supa
                .from("daily_scans")
                .select("symbol")
                .eq("date", date)
                .eq("universe_slug", universe_slug)
                .eq("strategy_version", strategy_version)
                .order("rank_score", { ascending: false, nullsFirst: false })
                .order("confidence", { ascending: false })
                .limit(5);
              for (const row of writtenRows ?? []) {
                if (summary.sample_written.length >= 20) break;
                const symbol = String((row as any)?.symbol ?? "").trim().toUpperCase();
                if (!symbol) continue;
                summary.sample_written.push({
                  date,
                  strategy_version,
                  universe_slug,
                  symbol,
                });
              }
            }
          }
        }
        item.dates_processed += 1;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        item.errors.push({ date, error: message });
      }
    }
    if (item.errors.length > 0) summary.ok = false;
    summary.per_strategy.push(item);
  }

  return summary;
}
