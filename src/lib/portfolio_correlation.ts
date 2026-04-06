export type PortfolioCorrelationState = "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" | "UNKNOWN";

export type PortfolioCorrelationHeldPosition = {
  symbol: string;
  industry_group?: string | null;
  theme?: string | null;
};

export type PortfolioCorrelationRowInput = {
  symbol: string;
  industry_group?: string | null;
  theme?: string | null;
};

export type PortfolioCorrelationResult = {
  state: PortfolioCorrelationState;
  label: string;
  summary: string;
  avg_correlation: number | null;
  max_correlation: number | null;
  correlated_holdings_count: number;
  compared_holdings_count: number;
  same_industry_count: number;
  same_theme_count: number;
  top_overlap_symbols: string[];
  warnings: string[];
};

export type PortfolioCorrelationSummary = {
  counts: {
    low: number;
    moderate: number;
    high: number;
    very_high: number;
    unknown: number;
  };
  top_overlap: Array<{
    symbol: string;
    state: PortfolioCorrelationState;
    label: string;
    summary: string;
  }>;
};

type PricePoint = {
  date: string;
  close: number;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function pearsonCorrelation(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 8) return null;
  const n = a.length;
  const meanA = a.reduce((sum, value) => sum + value, 0) / n;
  const meanB = b.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA <= 0 || varianceB <= 0) return null;
  return numerator / Math.sqrt(varianceA * varianceB);
}

function toReturnMap(series: PricePoint[]) {
  const asc = [...series]
    .filter((point) => Number.isFinite(point.close) && point.close > 0 && point.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const returns = new Map<string, number>();
  for (let i = 1; i < asc.length; i += 1) {
    const prev = asc[i - 1]?.close ?? 0;
    const current = asc[i]?.close ?? 0;
    if (!(prev > 0) || !(current > 0)) continue;
    returns.set(asc[i].date, current / prev - 1);
  }
  return returns;
}

function pairCorrelation(baseSeries: PricePoint[], heldSeries: PricePoint[]) {
  const baseReturns = toReturnMap(baseSeries);
  const heldReturns = toReturnMap(heldSeries);
  const sharedDates = [...baseReturns.keys()]
    .filter((date) => heldReturns.has(date))
    .sort()
    .slice(-20);
  if (sharedDates.length < 8) return null;
  const a = sharedDates.map((date) => baseReturns.get(date) ?? 0);
  const b = sharedDates.map((date) => heldReturns.get(date) ?? 0);
  return pearsonCorrelation(a, b);
}

function labelForState(state: PortfolioCorrelationState) {
  switch (state) {
    case "LOW":
      return "Low overlap";
    case "MODERATE":
      return "Moderate overlap";
    case "HIGH":
      return "High overlap";
    case "VERY_HIGH":
      return "Very high overlap";
    default:
      return "Overlap unknown";
  }
}

export function buildPortfolioCorrelation(
  row: PortfolioCorrelationRowInput,
  heldPositions: PortfolioCorrelationHeldPosition[],
  priceHistoryBySymbol: Map<string, PricePoint[]>
): PortfolioCorrelationResult {
  const symbol = normalize(row.symbol).toUpperCase();
  const rowIndustry = normalize(row.industry_group);
  const rowTheme = normalize(row.theme);
  const held = Array.isArray(heldPositions) ? heldPositions : [];
  if (held.length === 0) {
    return {
      state: "LOW",
      label: labelForState("LOW"),
      summary: "No open holdings to compare against, so overlap risk is currently low.",
      avg_correlation: null,
      max_correlation: null,
      correlated_holdings_count: 0,
      compared_holdings_count: 0,
      same_industry_count: 0,
      same_theme_count: 0,
      top_overlap_symbols: [],
      warnings: [],
    };
  }

  const baseSeries = priceHistoryBySymbol.get(symbol) ?? [];
  const sameIndustryCount = rowIndustry
    ? held.filter((position) => normalize(position.industry_group) === rowIndustry).length
    : 0;
  const sameThemeCount = rowTheme
    ? held.filter((position) => normalize(position.theme) === rowTheme).length
    : 0;

  const correlations = held
    .map((position) => {
      const heldSymbol = normalize(position.symbol).toUpperCase();
      if (!heldSymbol || heldSymbol === symbol) {
        return {
          symbol: heldSymbol,
          correlation: 1,
        };
      }
      const heldSeries = priceHistoryBySymbol.get(heldSymbol) ?? [];
      const correlation = baseSeries.length > 1 && heldSeries.length > 1 ? pairCorrelation(baseSeries, heldSeries) : null;
      return { symbol: heldSymbol, correlation };
    })
    .filter((item) => item.symbol);

  const validCorrelations = correlations
    .filter((item): item is { symbol: string; correlation: number } => typeof item.correlation === "number" && Number.isFinite(item.correlation))
    .sort((a, b) => b.correlation - a.correlation);

  const comparedCount = validCorrelations.length;
  const avgCorrelation =
    comparedCount > 0
      ? validCorrelations.reduce((sum, item) => sum + item.correlation, 0) / comparedCount
      : null;
  const maxCorrelation = comparedCount > 0 ? validCorrelations[0].correlation : null;
  const correlatedHoldingsCount = validCorrelations.filter((item) => item.correlation >= 0.7).length;
  const topOverlapSymbols = validCorrelations.slice(0, 3).map((item) => item.symbol);

  let state: PortfolioCorrelationState = "UNKNOWN";
  if (normalize(symbol) && held.some((position) => normalize(position.symbol).toUpperCase() === symbol)) {
    state = "VERY_HIGH";
  } else if ((maxCorrelation ?? -1) >= 0.85 || sameIndustryCount >= 2 || sameThemeCount >= 2) {
    state = "VERY_HIGH";
  } else if ((maxCorrelation ?? -1) >= 0.7 || sameIndustryCount >= 1 || sameThemeCount >= 1) {
    state = "HIGH";
  } else if ((avgCorrelation ?? -1) >= 0.45 || correlatedHoldingsCount > 0) {
    state = "MODERATE";
  } else if (comparedCount > 0 || held.length > 0) {
    state = "LOW";
  }

  const warnings: string[] = [];
  if (held.some((position) => normalize(position.symbol).toUpperCase() === symbol)) {
    warnings.push("This symbol is already held in the portfolio");
  }
  if ((maxCorrelation ?? -1) >= 0.85 && topOverlapSymbols[0]) {
    warnings.push(`Recent returns are moving very closely with ${topOverlapSymbols[0]}`);
  } else if ((maxCorrelation ?? -1) >= 0.7 && topOverlapSymbols[0]) {
    warnings.push(`Recent returns are meaningfully overlapping with ${topOverlapSymbols[0]}`);
  }
  if (sameIndustryCount >= 1 && rowIndustry) warnings.push(`You already hold ${sameIndustryCount} name(s) in ${rowIndustry}`);
  if (sameThemeCount >= 1 && rowTheme) warnings.push(`You already hold ${sameThemeCount} name(s) tied to ${rowTheme}`);

  const summaryBits: string[] = [];
  if (state === "LOW") {
    summaryBits.push("This idea is not strongly overlapping with current holdings.");
  } else if (state === "MODERATE") {
    summaryBits.push("This idea has some overlap with the current book.");
  } else if (state === "HIGH") {
    summaryBits.push("This idea overlaps materially with existing exposure.");
  } else if (state === "VERY_HIGH") {
    summaryBits.push("This idea is effectively doubling an existing bet.");
  } else {
    summaryBits.push("Not enough shared price history is available to judge overlap cleanly.");
  }
  if (topOverlapSymbols.length > 0) summaryBits.push(`Closest overlap: ${topOverlapSymbols.join(", ")}.`);
  if (avgCorrelation != null) summaryBits.push(`Avg corr ${avgCorrelation.toFixed(2)}.`);

  return {
    state,
    label: labelForState(state),
    summary: summaryBits.join(" "),
    avg_correlation: avgCorrelation != null ? Math.round(avgCorrelation * 100) / 100 : null,
    max_correlation: maxCorrelation != null ? Math.round(maxCorrelation * 100) / 100 : null,
    correlated_holdings_count: correlatedHoldingsCount,
    compared_holdings_count: comparedCount,
    same_industry_count: sameIndustryCount,
    same_theme_count: sameThemeCount,
    top_overlap_symbols: topOverlapSymbols,
    warnings: unique(warnings).slice(0, 4),
  };
}

export function summarizePortfolioCorrelation(
  rows: Array<{ symbol: string; correlation_context?: PortfolioCorrelationResult | null }>
): PortfolioCorrelationSummary {
  const counts = {
    low: 0,
    moderate: 0,
    high: 0,
    very_high: 0,
    unknown: 0,
  };

  const sorted = rows
    .map((row) => ({ symbol: row.symbol, context: row.correlation_context ?? null }))
    .filter((row): row is { symbol: string; context: PortfolioCorrelationResult } => Boolean(row.context))
    .sort((a, b) => {
      const score = (state: PortfolioCorrelationState) => {
        switch (state) {
          case "VERY_HIGH": return 4;
          case "HIGH": return 3;
          case "MODERATE": return 2;
          case "LOW": return 1;
          default: return 0;
        }
      };
      const delta = score(b.context.state) - score(a.context.state);
      if (delta !== 0) return delta;
      return (b.context.max_correlation ?? -1) - (a.context.max_correlation ?? -1);
    });

  for (const row of sorted) {
    switch (row.context.state) {
      case "LOW": counts.low += 1; break;
      case "MODERATE": counts.moderate += 1; break;
      case "HIGH": counts.high += 1; break;
      case "VERY_HIGH": counts.very_high += 1; break;
      default: counts.unknown += 1; break;
    }
  }

  return {
    counts,
    top_overlap: sorted.slice(0, 5).map((row) => ({
      symbol: row.symbol,
      state: row.context.state,
      label: row.context.label,
      summary: row.context.summary,
    })),
  };
}
