import { runScanPipeline, type ScanEngineClient } from "@/lib/scan_engine";
import {
  CORE_MOMENTUM_DEFAULT_UNIVERSE,
  CORE_MOMENTUM_DEFAULT_VERSION,
} from "@/lib/strategy/coreMomentumSwing";

export type BackfillMomentumInput = {
  start_date: string;
  end_date: string;
  universe_slug?: string;
  strategy_version?: string;
};

export type BackfillMomentumSummary = {
  ok: boolean;
  strategy_version: string;
  universe_slug: string;
  start_date: string;
  end_date: string;
  trading_days_processed: number;
  rows_inserted: number;
  rows_skipped: number;
  errors: Array<{ date: string; error: string }>;
};

export async function runMomentumHistoryBackfill(opts: {
  supabase: ScanEngineClient;
  input: BackfillMomentumInput;
}): Promise<BackfillMomentumSummary> {
  const supa = opts.supabase as any;
  const start = String(opts.input.start_date ?? "").slice(0, 10);
  const end = String(opts.input.end_date ?? "").slice(0, 10);
  const universe_slug = String(opts.input.universe_slug ?? CORE_MOMENTUM_DEFAULT_UNIVERSE).trim() || CORE_MOMENTUM_DEFAULT_UNIVERSE;
  const strategy_version = String(opts.input.strategy_version ?? CORE_MOMENTUM_DEFAULT_VERSION).trim() || CORE_MOMENTUM_DEFAULT_VERSION;

  if (!start || !end) {
    throw new Error("start_date and end_date are required");
  }
  if (start > end) {
    throw new Error("start_date must be <= end_date");
  }

  const { data: tradingDays, error: dayErr } = await supa
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });
  if (dayErr) throw dayErr;

  const uniqueDays: string[] = Array.from(
    new Set((tradingDays ?? []).map((d: any) => String(d?.date ?? "")).filter(Boolean))
  );
  let trading_days_processed = 0;
  let rows_inserted = 0;
  let rows_skipped = 0;
  const errors: Array<{ date: string; error: string }> = [];

  for (const day of uniqueDays) {
    const result = await runScanPipeline({
      supabase: supa,
      universe_slug,
      strategy_version,
      scan_date: day,
      offset: 0,
      limit: 2000,
      finalize: true,
    });
    if (!result.ok) {
      errors.push({ date: day, error: String((result as any).error ?? "scan failed") });
      continue;
    }
    trading_days_processed += 1;
    rows_inserted += Number((result as any).upserted ?? 0);
    rows_skipped += Math.max(0, Number((result as any).processed ?? 0) - Number((result as any).scored ?? 0));
  }

  return {
    ok: errors.length === 0,
    strategy_version,
    universe_slug,
    start_date: start,
    end_date: end,
    trading_days_processed,
    rows_inserted,
    rows_skipped,
    errors,
  };
}
