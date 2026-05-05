const BASE = "https://sgresult.com";

function normalizeDate(value) {
  const raw = String(value || "").replace(/\((.*?)\)/g, "").trim();
  const ymd = raw.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;

  const dmy = raw.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+((?:20|19)\d{2})\b/);
  if (dmy) {
    const months = {
      jan: "01",
      january: "01",
      feb: "02",
      february: "02",
      mar: "03",
      march: "03",
      apr: "04",
      april: "04",
      may: "05",
      jun: "06",
      june: "06",
      jul: "07",
      july: "07",
      aug: "08",
      august: "08",
      sep: "09",
      september: "09",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      dec: "12",
      december: "12",
    };
    const month = months[dmy[2].toLowerCase()];
    if (month) return `${dmy[3]}-${month}-${dmy[1].padStart(2, "0")}`;
  }

  return null;
}

function unique(values) {
  return Array.from(new Set(values));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function fetchText(url, xhr = false) {
  const res = await fetch(url, {
    headers: xhr ? { "X-Requested-With": "XMLHttpRequest", "User-Agent": "SG Lottery Lab" } : { "User-Agent": "SG Lottery Lab" },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.text();
}

function parseTotoCards(html) {
  return html
    .split('<div class="lottery-card">')
    .slice(1)
    .map((card) => {
      const dateRaw = card.match(/class="toto-date">\s*([^<]+?)\s*<\/div>/)?.[1];
      const date = normalizeDate(dateRaw);
      const balls = Array.from(card.matchAll(/class="toto-ball(?: additional)?">\s*(\d{1,2}|xx)\s*<\/div>/g)).map((m) => m[1]);
      if (!date || balls.length < 7 || balls.includes("xx")) return null;
      return {
        date,
        main: balls.slice(0, 6).map((n) => Number(n)),
        additional: Number(balls[6]),
      };
    })
    .filter(Boolean);
}

async function loadToto(maxPages) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? `${BASE}/toto-results` : `${BASE}/toto-results?page=${page}`;
    const html = await fetchText(url, page > 1);
    const parsed = parseTotoCards(html);
    if (parsed.length === 0) break;
    rows.push(...parsed);
  }

  const seen = new Set();
  const deduped = rows.filter((row) => {
    const key = `${row.date}:${row.main.join("-")}:${row.additional}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const lines = ["date,draw_no,n1,n2,n3,n4,n5,n6,additional"];
  deduped.forEach((row) => lines.push([row.date, "", ...row.main, row.additional].map(csvCell).join(",")));
  return { game: "toto", rows: deduped.length, csv: lines.join("\n") };
}

function parseFourDSummaryLinks(html) {
  return unique(Array.from(html.matchAll(/https:\/\/sgresult\.com\/4d-results\/[a-z0-9-]+/g)).map((m) => m[0]));
}

function extractPrize(html, label) {
  const pattern = new RegExp(`<h2>${label}<\\/h2>[\\s\\S]*?<div class="prize-number">\\s*(\\d{4})\\s*<\\/div>`, "i");
  return html.match(pattern)?.[1] ?? null;
}

function extractGridSection(html, startLabel, endLabel) {
  const start = html.indexOf(startLabel);
  if (start < 0) return [];
  const rest = html.slice(start);
  const end = endLabel ? rest.indexOf(endLabel) : -1;
  const section = end >= 0 ? rest.slice(0, end) : rest;
  return Array.from(section.matchAll(/class="grid-number">\s*(\d{4})\s*<\/div>/g)).map((m) => m[1]);
}

function parseFourDDetail(html, fallbackUrl) {
  const dateRaw =
    html.match(/id="4d-date"[^>]*data-full="([^"]+)"/)?.[1] ??
    html.match(/Singapore 4D Results For ([^|<]+?)\s*\|/)?.[1] ??
    fallbackUrl.split("/").pop()?.replace(/-/g, " ");
  const date = normalizeDate(dateRaw);
  const first = extractPrize(html, "First Prize");
  const second = extractPrize(html, "Second");
  const third = extractPrize(html, "Third");
  if (!date || !first || !second || !third) return null;

  return {
    date,
    first,
    second,
    third,
    others: [...extractGridSection(html, "Starter Prizes", "Consolation Prizes"), ...extractGridSection(html, "Consolation Prizes", "Analyze 4D")],
  };
}

async function mapInBatches(items, batchSize, mapper) {
  const result = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    result.push(...(await Promise.all(batch.map(mapper))));
  }
  return result;
}

async function loadFourD(maxPages, maxDraws) {
  const links = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? `${BASE}/4d-results` : `${BASE}/4d-results?page=${page}`;
    const html = await fetchText(url, page > 1);
    const parsed = parseFourDSummaryLinks(html);
    if (parsed.length === 0) break;
    links.push(...parsed);
  }

  const detailLinks = unique(links).slice(0, maxDraws);
  const details = await mapInBatches(detailLinks, 5, async (url) => {
    try {
      return parseFourDDetail(await fetchText(url), url);
    } catch {
      return null;
    }
  });

  const rows = details.filter(Boolean);
  const lines = ["date,draw_no,first,second,third,starter,consolation"];
  rows.forEach((row) => {
    const starter = row.others.slice(0, 10).join(" ");
    const consolation = row.others.slice(10).join(" ");
    lines.push([row.date, "", row.first, row.second, row.third, starter, consolation].map(csvCell).join(","));
  });
  return { game: "4d", rows: rows.length, csv: lines.join("\n") };
}

async function handler(req, res) {
  try {
    const game = String(req.query.game || "").toLowerCase();
    const pages = Math.min(Math.max(Number(req.query.pages || (game === "4d" ? 8 : 30)), 1), game === "4d" ? 20 : 80);
    const maxDraws = Math.min(Math.max(Number(req.query.maxDraws || 96), 12), 240);
    const payload = game === "4d" ? await loadFourD(pages, maxDraws) : game === "toto" ? await loadToto(pages) : null;

    if (!payload) {
      res.status(400).json({ ok: false, error: "Use ?game=4d or ?game=toto" });
      return;
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({ ok: true, source: "sgresult.com", ...payload });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

handler._internal = {
  loadFourD,
  loadToto,
};

module.exports = handler;
