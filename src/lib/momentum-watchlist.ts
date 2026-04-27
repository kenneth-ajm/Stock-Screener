export type MomentumWatchlistSetup =
  | "EARLY_BASE"
  | "BREAKOUT_NEAR"
  | "BREAKOUT_CONFIRMED"
  | "PULLBACK_RETEST"
  | "EXTENDED_DO_NOT_CHASE"
  | "FAILED_BREAKOUT"
  | "NO_TRADE"
  | "INSUFFICIENT_DATA";

export type MomentumWatchlistSeed = {
  symbol: string;
  name: string;
  theme: string;
  popularLiquid?: boolean;
};

export type MomentumPriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MomentumWatchlistRow = {
  symbol: string;
  name: string;
  theme: string;
  popularLiquid: boolean;
  sourceDate: string | null;
  lastClose: number | null;
  previousClose: number | null;
  changePct: number | null;
  avgVolume20: number | null;
  relativeVolume: number | null;
  high5: number | null;
  high20: number | null;
  low20: number | null;
  sma5: number | null;
  sma10: number | null;
  sma20: number | null;
  atr14: number | null;
  setup: MomentumWatchlistSetup;
  entryTrigger: number | null;
  pullbackEntry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  riskPerShare: number | null;
  rewardRiskTp1: number | null;
  rewardRiskTp2: number | null;
  extended: boolean;
  doNotChase: boolean;
  nearBreakout: boolean;
  insufficientData: boolean;
  reasonSummary: string;
  reasonJson: Record<string, unknown>;
};

export const MOMENTUM_WATCHLIST_SEED: MomentumWatchlistSeed[] = [
  { symbol: "SOUN", name: "SoundHound AI", theme: "AI software" },
  { symbol: "OPEN", name: "Opendoor", theme: "Speculative housing tech" },
  { symbol: "JOBY", name: "Joby Aviation", theme: "eVTOL / future transport" },
  { symbol: "LCID", name: "Lucid", theme: "EV" },
  { symbol: "ACHR", name: "Archer Aviation", theme: "eVTOL / future transport" },
  { symbol: "QBTS", name: "D-Wave Quantum", theme: "Quantum computing" },
  { symbol: "RGTI", name: "Rigetti Computing", theme: "Quantum computing" },
  { symbol: "IONQ", name: "IonQ", theme: "Quantum computing" },
  { symbol: "PLUG", name: "Plug Power", theme: "Clean energy" },
  { symbol: "BYND", name: "Beyond Meat", theme: "Speculative consumer" },
  { symbol: "POET", name: "POET Technologies", theme: "Semiconductors / photonics" },
  { symbol: "AMPX", name: "Amprius Technologies", theme: "Battery tech" },
  { symbol: "RKLB", name: "Rocket Lab", theme: "Space / defense" },
  { symbol: "UPST", name: "Upstart", theme: "Fintech / AI lending", popularLiquid: true },
  { symbol: "SOFI", name: "SoFi", theme: "Fintech", popularLiquid: true },
  { symbol: "HOOD", name: "Robinhood", theme: "Trading / crypto beta", popularLiquid: true },
  { symbol: "PLTR", name: "Palantir", theme: "AI / data platforms", popularLiquid: true },
  { symbol: "AMD", name: "Advanced Micro Devices", theme: "Semiconductors", popularLiquid: true },
  { symbol: "UEC", name: "Uranium Energy", theme: "Uranium" },
  { symbol: "GPRO", name: "GoPro", theme: "Speculative consumer hardware" },
];

const SETUP_RANK: Record<MomentumWatchlistSetup, number> = {
  BREAKOUT_CONFIRMED: 0,
  BREAKOUT_NEAR: 1,
  PULLBACK_RETEST: 2,
  EARLY_BASE: 3,
  NO_TRADE: 4,
  EXTENDED_DO_NOT_CHASE: 5,
  FAILED_BREAKOUT: 6,
  INSUFFICIENT_DATA: 7,
};

function round2(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function round0(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  return average(values.slice(-period));
}

function maxHigh(bars: MomentumPriceBar[]) {
  if (!bars.length) return null;
  return Math.max(...bars.map((bar) => bar.high));
}

function minLow(bars: MomentumPriceBar[]) {
  if (!bars.length) return null;
  return Math.min(...bars.map((bar) => bar.low));
}

function trueRange(current: MomentumPriceBar, previous: MomentumPriceBar | null) {
  if (!previous) return current.high - current.low;
  return Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
}

function atr(barsAsc: MomentumPriceBar[], period: number) {
  if (barsAsc.length < period + 1) return null;
  const ranges = barsAsc.map((bar, index) => trueRange(bar, index > 0 ? barsAsc[index - 1] : null));
  return average(ranges.slice(-period));
}

function pctFromLevel(price: number | null, level: number | null) {
  if (price == null || level == null || level <= 0) return null;
  return ((level - price) / level) * 100;
}

function pctAboveLevel(price: number | null, level: number | null) {
  if (price == null || level == null || level <= 0) return null;
  return ((price - level) / level) * 100;
}

function findRecentBreakout(barsAsc: MomentumPriceBar[]) {
  const start = Math.max(20, barsAsc.length - 5);
  let latestBreakout: { level: number; breakoutHigh: number; date: string } | null = null;
  for (let i = start; i < barsAsc.length; i += 1) {
    const prior = barsAsc.slice(Math.max(0, i - 20), i);
    const level = maxHigh(prior);
    const bar = barsAsc[i];
    if (level != null && bar.high > level && bar.close > level) {
      latestBreakout = { level, breakoutHigh: bar.high, date: bar.date };
    }
  }
  return latestBreakout;
}

function madeRecentHighThenFailed(barsAsc: MomentumPriceBar[], latestClose: number) {
  if (barsAsc.length < 24) return { failed: false, level: null as number | null };
  const latestIndex = barsAsc.length - 1;
  for (let i = Math.max(20, latestIndex - 2); i <= latestIndex; i += 1) {
    const prior = barsAsc.slice(Math.max(0, i - 20), i);
    const level = maxHigh(prior);
    if (level != null && barsAsc[i].high > level && latestClose < level * 0.97) {
      return { failed: true, level };
    }
  }
  return { failed: false, level: null };
}

function classify(input: {
  latest: MomentumPriceBar;
  previous: MomentumPriceBar;
  barsAsc: MomentumPriceBar[];
  high20: number | null;
  low20: number | null;
  sma5: number | null;
  sma10: number | null;
  atr14: number | null;
  relativeVolume: number | null;
  changePct: number | null;
}) {
  const { latest, barsAsc, high20, low20, sma5, sma10, relativeVolume, changePct } = input;
  const latestClose = latest.close;
  const low5 = minLow(barsAsc.slice(-5));
  const distanceTo20High = pctFromLevel(latestClose, high20);
  const closeAbove20HighPct = pctAboveLevel(latestClose, high20);
  const from5LowPct = low5 && low5 > 0 ? ((latestClose - low5) / low5) * 100 : null;
  const aboveSma5Pct = pctAboveLevel(latestClose, sma5);
  const extended =
    Boolean(from5LowPct != null && aboveSma5Pct != null && from5LowPct > 12 && aboveSma5Pct > 8) ||
    Boolean(changePct != null && changePct > 15);
  const recentBreakout = findRecentBreakout(barsAsc);
  const failed = madeRecentHighThenFailed(barsAsc, latestClose);
  const nearBreakout = distanceTo20High != null && distanceTo20High >= 0 && distanceTo20High <= 3;
  const breakoutConfirmed = closeAbove20HighPct != null && closeAbove20HighPct > 0 && (relativeVolume ?? 0) >= 1.3;
  const breakoutNear = nearBreakout && (relativeVolume ?? 0) >= 1.1;
  const retestPullbackPct =
    recentBreakout && recentBreakout.breakoutHigh > 0 ? ((recentBreakout.breakoutHigh - latestClose) / recentBreakout.breakoutHigh) * 100 : null;
  const pullbackRetest =
    Boolean(recentBreakout && retestPullbackPct != null && retestPullbackPct >= 0 && retestPullbackPct < 6 && latestClose >= recentBreakout.level) ||
    Boolean(recentBreakout && sma5 != null && sma10 != null && latestClose >= Math.min(sma5, sma10) && latestClose >= recentBreakout.level);
  const range5 = maxHigh(barsAsc.slice(-5)) != null && minLow(barsAsc.slice(-5)) != null
    ? ((maxHigh(barsAsc.slice(-5))! - minLow(barsAsc.slice(-5))!) / latestClose) * 100
    : null;
  const range20 = high20 != null && low20 != null ? ((high20 - low20) / latestClose) * 100 : null;
  const within10PctOf20Low = low20 != null && low20 > 0 && ((latestClose - low20) / low20) * 100 <= 10;
  const volatilityCompressed = range5 != null && range20 != null ? range5 <= range20 * 0.65 || range5 <= 10 : false;
  const earlyVolumeRise = (relativeVolume ?? 0) >= 0.9 && latest.volume >= (average(barsAsc.slice(-5).map((bar) => bar.volume)) ?? 0);
  const earlyBase = within10PctOf20Low && volatilityCompressed && earlyVolumeRise;

  let setup: MomentumWatchlistSetup = "NO_TRADE";
  if (failed.failed) setup = "FAILED_BREAKOUT";
  else if (extended) setup = "EXTENDED_DO_NOT_CHASE";
  else if (breakoutConfirmed) setup = "BREAKOUT_CONFIRMED";
  else if (breakoutNear) setup = "BREAKOUT_NEAR";
  else if (pullbackRetest) setup = "PULLBACK_RETEST";
  else if (earlyBase) setup = "EARLY_BASE";

  return {
    setup,
    extended,
    nearBreakout,
    failedBreakoutLevel: failed.level,
    recentBreakoutLevel: recentBreakout?.level ?? null,
    range5,
    range20,
    from5LowPct,
    aboveSma5Pct,
    retestPullbackPct,
  };
}

function setupLabel(setup: MomentumWatchlistSetup) {
  return setup.replaceAll("_", " ");
}

function buildReason(input: {
  setup: MomentumWatchlistSetup;
  distanceTo20High: number | null;
  relativeVolume: number | null;
  changePct: number | null;
  extended: boolean;
  failedBreakoutLevel: number | null;
  recentBreakoutLevel: number | null;
}) {
  const rv = input.relativeVolume != null ? `${input.relativeVolume.toFixed(2)}x relative volume` : "relative volume unavailable";
  const dist = input.distanceTo20High != null ? `${Math.abs(input.distanceTo20High).toFixed(1)}% ${input.distanceTo20High >= 0 ? "below" : "above"} 20D breakout` : "20D breakout distance unavailable";
  if (input.setup === "BREAKOUT_CONFIRMED") return `Confirmed 20D breakout with ${rv}. Not extended.`;
  if (input.setup === "BREAKOUT_NEAR") return `Near 20D breakout, ${dist}, with ${rv}. Not extended.`;
  if (input.setup === "PULLBACK_RETEST") return `Pullback retest after breakout. Watch for hold above ${round2(input.recentBreakoutLevel) ?? "the prior level"}.`;
  if (input.setup === "EARLY_BASE") return `Early base near the lower part of its 20D range with volume starting to improve.`;
  if (input.setup === "EXTENDED_DO_NOT_CHASE") {
    return input.changePct != null && input.changePct > 15
      ? `Already up ${input.changePct.toFixed(1)}% on the latest daily bar. Marked EXTENDED_DO_NOT_CHASE.`
      : "Price is stretched above its short-term base. Marked EXTENDED_DO_NOT_CHASE.";
  }
  if (input.setup === "FAILED_BREAKOUT") return `Failed recent breakout near ${round2(input.failedBreakoutLevel) ?? "the prior level"}. Avoid until reclaim.`;
  if (input.setup === "INSUFFICIENT_DATA") return "Insufficient cached daily bars to classify this ticker.";
  return `No clean 1-2 day momentum setup. ${dist}; ${rv}.`;
}

export function computeMomentumWatchlistRow(seed: MomentumWatchlistSeed, barsDesc: MomentumPriceBar[]): MomentumWatchlistRow {
  const barsAsc = [...barsDesc].reverse().filter((bar) => Number.isFinite(bar.close) && Number.isFinite(bar.high) && Number.isFinite(bar.low));
  if (barsAsc.length < 22) {
    return {
      symbol: seed.symbol,
      name: seed.name,
      theme: seed.theme,
      popularLiquid: Boolean(seed.popularLiquid),
      sourceDate: barsDesc[0]?.date ?? null,
      lastClose: barsDesc[0]?.close ?? null,
      previousClose: barsDesc[1]?.close ?? null,
      changePct: null,
      avgVolume20: null,
      relativeVolume: null,
      high5: null,
      high20: null,
      low20: null,
      sma5: null,
      sma10: null,
      sma20: null,
      atr14: null,
      setup: "INSUFFICIENT_DATA",
      entryTrigger: null,
      pullbackEntry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      riskPerShare: null,
      rewardRiskTp1: null,
      rewardRiskTp2: null,
      extended: false,
      doNotChase: false,
      nearBreakout: false,
      insufficientData: true,
      reasonSummary: "Insufficient cached daily bars to classify this ticker.",
      reasonJson: { bars_count: barsAsc.length },
    };
  }

  const latest = barsAsc[barsAsc.length - 1];
  const previous = barsAsc[barsAsc.length - 2];
  const closes = barsAsc.map((bar) => bar.close);
  const latestClose = latest.close;
  const prior5 = barsAsc.slice(-6, -1);
  const prior20 = barsAsc.slice(-21, -1);
  const last20 = barsAsc.slice(-20);
  const avgVolume20 = average(last20.map((bar) => bar.volume));
  const relativeVolume = avgVolume20 && avgVolume20 > 0 ? latest.volume / avgVolume20 : null;
  const changePct = previous.close > 0 ? ((latestClose - previous.close) / previous.close) * 100 : null;
  const high5 = maxHigh(prior5);
  const high20 = maxHigh(prior20);
  const low20 = minLow(last20);
  const sma5Value = sma(closes, 5);
  const sma10Value = sma(closes, 10);
  const sma20Value = sma(closes, 20);
  const atr14Value = atr(barsAsc, 14);
  const classification = classify({
    latest,
    previous,
    barsAsc,
    high20,
    low20,
    sma5: sma5Value,
    sma10: sma10Value,
    atr14: atr14Value,
    relativeVolume,
    changePct,
  });
  const breakoutLevel = high20 ?? latestClose;
  const entryTrigger = atr14Value != null ? breakoutLevel + 0.2 * atr14Value : breakoutLevel;
  const supportArea = average([sma5Value, sma10Value].filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  const pullbackEntry = classification.recentBreakoutLevel ?? supportArea ?? breakoutLevel;
  const recentSwingLow = minLow(barsAsc.slice(-5));
  const atrStop = atr14Value != null ? entryTrigger - 1.2 * atr14Value : entryTrigger * 0.92;
  const swingStop = recentSwingLow != null ? recentSwingLow * 0.99 : null;
  const stopLoss = Math.max(...[atrStop, swingStop].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value < entryTrigger));
  const riskPerShare = entryTrigger > stopLoss ? entryTrigger - stopLoss : null;
  const tp1 = riskPerShare != null ? entryTrigger + 1.5 * riskPerShare : null;
  const tp2 = riskPerShare != null ? entryTrigger + 2.5 * riskPerShare : null;
  const distanceTo20High = pctFromLevel(latestClose, high20);
  const reasonSummary = buildReason({
    setup: classification.setup,
    distanceTo20High,
    relativeVolume,
    changePct,
    extended: classification.extended,
    failedBreakoutLevel: classification.failedBreakoutLevel,
    recentBreakoutLevel: classification.recentBreakoutLevel,
  });

  return {
    symbol: seed.symbol,
    name: seed.name,
    theme: seed.theme,
    popularLiquid: Boolean(seed.popularLiquid),
    sourceDate: latest.date,
    lastClose: round2(latestClose),
    previousClose: round2(previous.close),
    changePct: round2(changePct),
    avgVolume20: round0(avgVolume20),
    relativeVolume: round2(relativeVolume),
    high5: round2(high5),
    high20: round2(high20),
    low20: round2(low20),
    sma5: round2(sma5Value),
    sma10: round2(sma10Value),
    sma20: round2(sma20Value),
    atr14: round2(atr14Value),
    setup: classification.setup,
    entryTrigger: round2(entryTrigger),
    pullbackEntry: round2(pullbackEntry),
    stopLoss: round2(stopLoss),
    tp1: round2(tp1),
    tp2: round2(tp2),
    riskPerShare: round2(riskPerShare),
    rewardRiskTp1: riskPerShare != null && tp1 != null ? round2((tp1 - entryTrigger) / riskPerShare) : null,
    rewardRiskTp2: riskPerShare != null && tp2 != null ? round2((tp2 - entryTrigger) / riskPerShare) : null,
    extended: classification.extended,
    doNotChase: classification.setup === "EXTENDED_DO_NOT_CHASE" || classification.setup === "FAILED_BREAKOUT",
    nearBreakout: classification.nearBreakout,
    insufficientData: false,
    reasonSummary,
    reasonJson: {
      setup_label: setupLabel(classification.setup),
      distance_to_5d_high_pct: round2(pctFromLevel(latestClose, high5)),
      distance_to_20d_high_pct: round2(distanceTo20High),
      from_5d_low_pct: round2(classification.from5LowPct),
      above_sma5_pct: round2(classification.aboveSma5Pct),
      range_5d_pct: round2(classification.range5),
      range_20d_pct: round2(classification.range20),
      recent_breakout_level: round2(classification.recentBreakoutLevel),
      failed_breakout_level: round2(classification.failedBreakoutLevel),
    },
  };
}

export function sortMomentumRows(rows: MomentumWatchlistRow[]) {
  return [...rows].sort((a, b) => {
    const setupDiff = SETUP_RANK[a.setup] - SETUP_RANK[b.setup];
    if (setupDiff !== 0) return setupDiff;
    const rvDiff = Number(b.relativeVolume ?? -999) - Number(a.relativeVolume ?? -999);
    if (rvDiff !== 0) return rvDiff;
    return a.symbol.localeCompare(b.symbol);
  });
}
