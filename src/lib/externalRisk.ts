const RISK_KEYWORDS = [
  "lawsuit",
  "sec",
  "fda",
  "downgrade",
  "bankruptcy",
  "offering",
  "probe",
  "investigation",
  "restatement",
];

export type NewsRiskRow = {
  news_risk: boolean;
  matched_keywords: string[];
  headline: string | null;
  published_utc: string | null;
};

export type EarningsRiskRow = {
  event_risk: boolean;
  earnings_in_days: number | null;
  earnings_date: string | null;
};

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(t) };
}

function weekdaysBetweenInclusive(from: string, to: string) {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
  let d = new Date(a);
  let count = 0;
  while (d <= b) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) count += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return Math.max(0, count - 1);
}

function defaultNews(symbols: string[]) {
  const out: Record<string, NewsRiskRow> = {};
  for (const s of symbols) {
    out[s] = { news_risk: false, matched_keywords: [], headline: null, published_utc: null };
  }
  return out;
}

function defaultEarnings(symbols: string[]) {
  const out: Record<string, EarningsRiskRow> = {};
  for (const s of symbols) {
    out[s] = { event_risk: false, earnings_in_days: null, earnings_date: null };
  }
  return out;
}

export async function fetchNewsRiskFlags(symbols: string[]) {
  const apiKey = process.env.POLYGON_API_KEY;
  const clean = [...new Set(symbols.map((s) => String(s || "").toUpperCase().trim()).filter(Boolean))];
  const out = defaultNews(clean);
  if (!apiKey || clean.length === 0) return out;

  await Promise.all(
    clean.map(async (symbol) => {
      const { signal, clear } = timeoutSignal(8000);
      try {
        const url = `https://api.polygon.io/v2/reference/news?ticker=${encodeURIComponent(
          symbol
        )}&limit=10&order=desc&sort=published_utc&apiKey=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as { results?: Array<any> } | null;
        const items = Array.isArray(json?.results) ? json.results : [];
        for (const item of items) {
          const text = `${String(item?.title ?? "")} ${String(item?.description ?? "")}`.toLowerCase();
          const matched = RISK_KEYWORDS.filter((kw) => text.includes(kw));
          if (matched.length === 0) continue;
          out[symbol] = {
            news_risk: true,
            matched_keywords: matched,
            headline: String(item?.title ?? "").trim() || null,
            published_utc: String(item?.published_utc ?? "").trim() || null,
          };
          break;
        }
      } catch {
        // keep default false when provider fails
      } finally {
        clear();
      }
    })
  );

  return out;
}

export async function fetchEarningsRiskFlags(symbols: string[], asOfDate: string) {
  const apiKey = process.env.POLYGON_API_KEY;
  const clean = [...new Set(symbols.map((s) => String(s || "").toUpperCase().trim()).filter(Boolean))];
  const out = defaultEarnings(clean);
  if (!apiKey || clean.length === 0) return out;

  await Promise.all(
    clean.map(async (symbol) => {
      const { signal, clear } = timeoutSignal(8000);
      try {
        // Best-effort endpoint for upcoming company events; if unavailable we keep neutral defaults.
        const url = `https://api.polygon.io/vX/reference/tickers/${encodeURIComponent(
          symbol
        )}/events?types=earnings&apiKey=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as { results?: Array<any> } | null;
        const items = Array.isArray(json?.results) ? json.results : [];
        const event = items
          .map((x) => String(x?.date ?? x?.event_date ?? "").trim())
          .filter(Boolean)
          .sort()[0];
        if (!event) return;
        const inDays = weekdaysBetweenInclusive(asOfDate, event);
        const eventRisk = inDays !== null && inDays <= 5;
        out[symbol] = {
          event_risk: eventRisk,
          earnings_in_days: inDays,
          earnings_date: event,
        };
      } catch {
        // keep default false when provider fails
      } finally {
        clear();
      }
    })
  );

  return out;
}

