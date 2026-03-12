export type Signal = "BUY" | "WATCH" | "AVOID";

export type PostFilterBlocker =
  | "market_regime_block"
  | "earnings_proximity_block"
  | "relative_volume_block";

export type MarketRegimeGate = {
  pass: boolean;
  spy_close: number | null;
  spy_sma50: number | null;
  spy_sma200: number | null;
  regime_date_used: string | null;
  source: "price_bars" | "unavailable";
};

export type PostFilterInputRow = {
  signal: Signal;
  strategy_version: string;
  reason_summary: string | null;
  reason_json: Record<string, unknown> | null;
  earnings_date?: string | null;
};

export type PostFilterOutput = {
  signal: Signal;
  reason_summary: string;
  reason_json: Record<string, unknown>;
  filter_blockers: PostFilterBlocker[];
  market_regime_pass: boolean;
  earnings_clear: boolean;
  relative_volume_pass: boolean;
};

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (!isObject(current)) return null;
    current = current[key];
  }
  return current;
}

function pickFirstNumber(obj: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const n = toNumber(getPath(obj, path));
    if (n != null) return n;
  }
  return null;
}

function normalizeReasonJson(value: unknown): Record<string, unknown> {
  return isObject(value) ? { ...value } : {};
}

function isRelativeVolumeStrategy(strategyVersion: string) {
  return strategyVersion === "v1" || strategyVersion === "v2_core_momentum" || strategyVersion === "v1_sector_momentum";
}

function extractEarningsWithinDays(input: PostFilterInputRow, reasonJson: Record<string, unknown>): number | null {
  const direct = pickFirstNumber(reasonJson, [
    ["flags", "earnings_within_days"],
    ["indicators", "earnings_within_days"],
    ["earnings_within_days"],
  ]);
  if (direct != null) return direct;

  const dateCandidates: Array<string | null> = [
    typeof input.earnings_date === "string" ? input.earnings_date : null,
    typeof getPath(reasonJson, ["flags", "earnings_date"]) === "string" ? (getPath(reasonJson, ["flags", "earnings_date"]) as string) : null,
    typeof getPath(reasonJson, ["earnings_date"]) === "string" ? (getPath(reasonJson, ["earnings_date"]) as string) : null,
    typeof getPath(reasonJson, ["next_earnings_date"]) === "string" ? (getPath(reasonJson, ["next_earnings_date"]) as string) : null,
  ];
  const iso = dateCandidates.find((v) => !!v);
  if (!iso) return null;

  const target = new Date(`${iso}T00:00:00Z`).getTime();
  if (!Number.isFinite(target)) return null;
  const now = Date.now();
  const days = Math.floor((target - now) / (24 * 60 * 60 * 1000));
  return Number.isFinite(days) ? days : null;
}

function extractRelativeVolume(reasonJson: Record<string, unknown>): number | null {
  return pickFirstNumber(reasonJson, [
    ["indicators", "volumeSpike"],
    ["metrics", "volume_expansion"],
    ["relative_volume"],
    ["indicators", "relativeVolume"],
  ]);
}

function appendSummary(base: string, blocks: PostFilterBlocker[], originalSignal: Signal, finalSignal: Signal) {
  const baseWithoutPriorFilterNote = base
    .replace(/\s+•\s+filters clear$/i, "")
    .replace(/\s+•\s+post-filter(?: BUY→WATCH| blocked): .+$/i, "")
    .trim();
  const safeBase = baseWithoutPriorFilterNote || `${originalSignal}`;
  if (blocks.length === 0) {
    return `${safeBase} • filters clear`;
  }
  const downgradeText = originalSignal === "BUY" && finalSignal === "WATCH" ? "post-filter BUY→WATCH" : "post-filter blocked";
  return `${safeBase} • ${downgradeText}: ${blocks.join(", ")}`;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const total = slice.reduce((sum, value) => sum + value, 0);
  return total / period;
}

export async function loadMarketRegimeGate(opts: { supabase: any; scan_date: string }): Promise<MarketRegimeGate> {
  try {
    const { data, error } = await opts.supabase
      .from("price_bars")
      .select("date,close")
      .eq("symbol", "SPY")
      .lte("date", opts.scan_date)
      .order("date", { ascending: false })
      .limit(260);

    if (error || !Array.isArray(data) || data.length < 200) {
      return {
        pass: false,
        spy_close: null,
        spy_sma50: null,
        spy_sma200: null,
        regime_date_used: null,
        source: "unavailable",
      };
    }

    const latest = data[0];
    const asc = [...data].reverse();
    const closes = asc
      .map((row: any) => toNumber(row?.close))
      .filter((v: number | null): v is number => v != null);

    const spyClose = toNumber(latest?.close);
    const spySma50 = sma(closes, 50);
    const spySma200 = sma(closes, 200);
    const pass =
      spyClose != null &&
      spySma50 != null &&
      spySma200 != null &&
      spyClose > spySma50 &&
      spyClose > spySma200;

    return {
      pass,
      spy_close: spyClose,
      spy_sma50: spySma50,
      spy_sma200: spySma200,
      regime_date_used: typeof latest?.date === "string" ? latest.date : null,
      source: "price_bars",
    };
  } catch {
    return {
      pass: false,
      spy_close: null,
      spy_sma50: null,
      spy_sma200: null,
      regime_date_used: null,
      source: "unavailable",
    };
  }
}

export function applyPostStrategyFilters(input: PostFilterInputRow, marketRegimeGate: MarketRegimeGate): PostFilterOutput {
  const originalSignal = input.signal;
  let signal = input.signal;
  const reasonJson = normalizeReasonJson(input.reason_json);
  const filterBlockers: PostFilterBlocker[] = [];

  const marketRegimePass = marketRegimeGate.pass;

  const earningsWithinDays = extractEarningsWithinDays(input, reasonJson);
  const earningsClear = earningsWithinDays == null || earningsWithinDays > 5;

  const relativeVolumeRequired = isRelativeVolumeStrategy(input.strategy_version);
  const relativeVolumeValue = extractRelativeVolume(reasonJson);
  const relativeVolumePass = !relativeVolumeRequired || (relativeVolumeValue != null && relativeVolumeValue >= 1.2);

  if (signal === "BUY" && !marketRegimePass) {
    signal = "WATCH";
    filterBlockers.push("market_regime_block");
  }

  if (signal === "BUY" && !earningsClear) {
    signal = "WATCH";
    filterBlockers.push("earnings_proximity_block");
  }

  if (signal === "BUY" && !relativeVolumePass) {
    signal = "WATCH";
    filterBlockers.push("relative_volume_block");
  }

  const existingBlockers = Array.isArray(reasonJson.filter_blockers)
    ? reasonJson.filter_blockers.filter((value): value is PostFilterBlocker =>
        value === "market_regime_block" || value === "earnings_proximity_block" || value === "relative_volume_block"
      )
    : [];
  const mergedBlockers = [...new Set([...existingBlockers, ...filterBlockers])];

  const nextReasonJson: Record<string, unknown> = {
    ...reasonJson,
    market_regime_pass: marketRegimePass,
    earnings_clear: earningsClear,
    relative_volume_pass: relativeVolumePass,
    filter_blockers: mergedBlockers,
    post_strategy_filters: {
      market_regime_pass: marketRegimePass,
      earnings_clear: earningsClear,
      earnings_within_days: earningsWithinDays,
      relative_volume_pass: relativeVolumePass,
      relative_volume_value: relativeVolumeValue,
      relative_volume_required: relativeVolumeRequired,
      blockers: mergedBlockers,
      market_regime: {
        source: marketRegimeGate.source,
        date_used: marketRegimeGate.regime_date_used,
        spy_close: marketRegimeGate.spy_close,
        spy_sma50: marketRegimeGate.spy_sma50,
        spy_sma200: marketRegimeGate.spy_sma200,
      },
    },
  };

  return {
    signal,
    reason_summary: appendSummary(String(input.reason_summary ?? ""), mergedBlockers, originalSignal, signal),
    reason_json: nextReasonJson,
    filter_blockers: mergedBlockers,
    market_regime_pass: marketRegimePass,
    earnings_clear: earningsClear,
    relative_volume_pass: relativeVolumePass,
  };
}
