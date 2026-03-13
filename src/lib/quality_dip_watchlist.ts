export type QualityDipGroup = "Leaders" | "Quality Cyclicals" | "Financials" | "Industrials & Defense" | "ETF Anchors";

export type QualityDipWatchItem = {
  symbol: string;
  name: string;
  group: QualityDipGroup;
};

export const QUALITY_DIP_WATCHLIST: QualityDipWatchItem[] = [
  { symbol: "AAPL", name: "Apple", group: "Leaders" },
  { symbol: "AMZN", name: "Amazon", group: "Leaders" },
  { symbol: "ASML", name: "ASML Holding ADR", group: "Leaders" },
  { symbol: "AVGO", name: "Broadcom", group: "Leaders" },
  { symbol: "GOOG", name: "Alphabet Class C", group: "Leaders" },
  { symbol: "GOOGL", name: "Alphabet Class A", group: "Leaders" },
  { symbol: "INTC", name: "Intel", group: "Leaders" },
  { symbol: "LRCX", name: "Lam Research", group: "Leaders" },
  { symbol: "META", name: "Meta Platforms", group: "Leaders" },
  { symbol: "MSFT", name: "Microsoft", group: "Leaders" },
  { symbol: "NVDA", name: "NVIDIA", group: "Leaders" },
  { symbol: "ORCL", name: "Oracle", group: "Leaders" },
  { symbol: "PLTR", name: "Palantir", group: "Leaders" },
  { symbol: "TSLA", name: "Tesla", group: "Leaders" },
  { symbol: "NFLX", name: "Netflix", group: "Leaders" },
  { symbol: "PANW", name: "Palo Alto Networks", group: "Leaders" },
  { symbol: "CRWD", name: "CrowdStrike", group: "Leaders" },

  { symbol: "NKE", name: "Nike", group: "Quality Cyclicals" },
  { symbol: "SBUX", name: "Starbucks", group: "Quality Cyclicals" },
  { symbol: "DIS", name: "Walt Disney", group: "Quality Cyclicals" },
  { symbol: "PFE", name: "Pfizer", group: "Quality Cyclicals" },
  { symbol: "UNH", name: "UnitedHealth Group", group: "Quality Cyclicals" },
  { symbol: "SONY", name: "Sony Group ADR", group: "Quality Cyclicals" },
  { symbol: "KO", name: "Coca-Cola", group: "Quality Cyclicals" },
  { symbol: "WM", name: "Waste Management", group: "Quality Cyclicals" },
  { symbol: "LUV", name: "Southwest Airlines", group: "Quality Cyclicals" },
  { symbol: "TSM", name: "Taiwan Semiconductor ADR", group: "Quality Cyclicals" },

  { symbol: "BAC", name: "Bank of America", group: "Financials" },
  { symbol: "C", name: "Citigroup", group: "Financials" },
  { symbol: "GS", name: "Goldman Sachs", group: "Financials" },
  { symbol: "JPM", name: "JPMorgan Chase", group: "Financials" },
  { symbol: "MS", name: "Morgan Stanley", group: "Financials" },
  { symbol: "BRK.B", name: "Berkshire Hathaway Class B", group: "Financials" },

  { symbol: "CAT", name: "Caterpillar", group: "Industrials & Defense" },
  { symbol: "CSCO", name: "Cisco Systems", group: "Industrials & Defense" },
  { symbol: "LMT", name: "Lockheed Martin", group: "Industrials & Defense" },

  { symbol: "QQQ", name: "Invesco QQQ Trust", group: "ETF Anchors" },
  { symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF", group: "ETF Anchors" },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", group: "ETF Anchors" },
];

export const QUALITY_DIP_EXCLUDED_SYMBOLS = ["2330.TW", "VWRA.L", "NOVO-B.CO", "KOF"] as const;
