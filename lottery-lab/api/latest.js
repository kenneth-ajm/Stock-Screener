function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#58;/g, ":")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function drawParam(drawNo) {
  return Buffer.from(`DrawNumber=${drawNo}`).toString("base64");
}

function normalizeDate(value) {
  const raw = stripTags(value);
  const dmy = raw.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+((?:20|19)\d{2})\b/i);
  if (!dmy) return null;
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
  return month ? `${dmy[3]}-${month}-${dmy[1].padStart(2, "0")}` : null;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SG Lottery Lab latest draw checker",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function extractTableBody(html, className) {
  return html.match(new RegExp(`<tbody class=['"]${className}['"]>([\\s\\S]*?)<\\/tbody>`, "i"))?.[1] ?? "";
}

function extractTdNumbers(html, digits) {
  return Array.from(html.matchAll(/<td[^>]*>\s*([0-9]+)\s*<\/td>/gi))
    .map((m) => m[1].padStart(digits, "0"))
    .filter((value) => value.length === digits);
}

function parseFourD(html, drawNo) {
  const actualDrawNo = Number(stripTags(html.match(/<th class=['"]drawNumber['"]>([\s\S]*?)<\/th>/i)?.[1] ?? "").match(/\d+/)?.[0] ?? NaN);
  if (actualDrawNo !== drawNo) return null;
  const date = normalizeDate(html.match(/<th class=['"]drawDate['"]>([\s\S]*?)<\/th>/i)?.[1] ?? "");
  const first = html.match(/class=['"]tdFirstPrize['"]>\s*(\d{4})\s*<\/td>/i)?.[1] ?? null;
  const second = html.match(/class=['"]tdSecondPrize['"]>\s*(\d{4})\s*<\/td>/i)?.[1] ?? null;
  const third = html.match(/class=['"]tdThirdPrize['"]>\s*(\d{4})\s*<\/td>/i)?.[1] ?? null;
  if (!date || !first || !second || !third) return null;
  return {
    date,
    drawNo,
    first,
    second,
    third,
    starter: extractTdNumbers(extractTableBody(html, "tbodyStarterPrizes"), 4),
    consolation: extractTdNumbers(extractTableBody(html, "tbodyConsolationPrizes"), 4),
  };
}

function parseToto(html, drawNo) {
  const actualDrawNo = Number(stripTags(html.match(/<th[^>]*class=['"]drawNumber['"][^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? "").match(/\d+/)?.[0] ?? NaN);
  if (actualDrawNo !== drawNo) return null;
  const date = normalizeDate(html.match(/<th[^>]*class=['"]drawDate['"][^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? "");
  const main = Array.from(html.matchAll(/class=['"]win\d['"]>\s*(\d{1,2})\s*<\/td>/gi)).map((m) => Number(m[1]));
  const additional = Number(html.match(/class=['"]additional['"]>\s*(\d{1,2})\s*<\/td>/i)?.[1] ?? NaN);
  if (!date || main.length !== 6 || !Number.isInteger(additional)) return null;
  if (main.some((number) => number > 49) || additional > 49 || date < "2014-10-01") return null;
  return { date, drawNo, main, additional };
}

function fourDLine(row) {
  return [row.date, row.drawNo, row.first, row.second, row.third, row.starter.join(" "), row.consolation.join(" ")].map(csvCell).join(",");
}

function totoLine(row) {
  return [row.date, row.drawNo, ...row.main, row.additional].map(csvCell).join(",");
}

async function mapBatches(items, batchSize, mapper) {
  const rows = [];
  for (let i = 0; i < items.length; i += batchSize) {
    rows.push(...(await Promise.all(items.slice(i, i + batchSize).map(mapper))));
  }
  return rows;
}

async function loadLatest(game, after, scan) {
  const drawNumbers = Array.from({ length: scan }, (_, index) => after + index + 1);
  const rows = await mapBatches(drawNumbers, 5, async (drawNo) => {
    try {
      const url =
        game === "4d"
          ? `https://www.singaporepools.com.sg/en/4d/pages/results.aspx?sppl=${drawParam(drawNo)}`
          : `https://www.singaporepools.com.sg/en/product/sr/pages/toto_results.aspx?sppl=${drawParam(drawNo)}`;
      const html = await fetchText(url);
      return game === "4d" ? parseFourD(html, drawNo) : parseToto(html, drawNo);
    } catch {
      return null;
    }
  });
  return rows.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.drawNo - b.drawNo);
}

module.exports = async function handler(req, res) {
  try {
    const game = String(req.query.game || "").toLowerCase();
    const after = Number(req.query.after || 0);
    const requestedScan = Number(req.query.scan || (game === "4d" ? 24 : 12));
    const scan = Math.min(Math.max(requestedScan, 1), game === "4d" ? 60 : 30);

    if (!["4d", "toto"].includes(game) || !Number.isFinite(after) || after <= 0) {
      res.status(400).json({ ok: false, error: "Use ?game=4d|toto&after=<latest_cached_draw_no>" });
      return;
    }

    const rows = await loadLatest(game, after, scan);
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=21600");
    res.status(200).json({
      ok: true,
      game,
      after,
      checkedThrough: after + scan,
      rows: rows.length,
      latestDrawNo: rows.at(-1)?.drawNo ?? after,
      latestDate: rows.at(-1)?.date ?? null,
      csvRows: rows.map(game === "4d" ? fourDLine : totoLine),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
