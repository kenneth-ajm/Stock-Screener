#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((item) => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

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
      "User-Agent": "SG Lottery Lab history builder",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function extractTableBody(html, className) {
  const match = html.match(new RegExp(`<tbody class=['"]${className}['"]>([\\s\\S]*?)<\\/tbody>`, "i"));
  return match?.[1] ?? "";
}

function extractTdNumbers(html, digits) {
  return Array.from(html.matchAll(/<td[^>]*>\s*([0-9]+)\s*<\/td>/gi))
    .map((m) => m[1].padStart(digits, "0"))
    .filter((value) => value.length === digits);
}

function parseFourD(html, drawNo) {
  const drawDateRaw = html.match(/<th class=['"]drawDate['"]>([\s\S]*?)<\/th>/i)?.[1] ?? "";
  const date = normalizeDate(drawDateRaw);
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
  const drawDateRaw = html.match(/<th[^>]*class=['"]drawDate['"][^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? "";
  const date = normalizeDate(drawDateRaw);
  const main = Array.from(html.matchAll(/class=['"]win\d['"]>\s*(\d{1,2})\s*<\/td>/gi)).map((m) => Number(m[1]));
  const additional = Number(html.match(/class=['"]additional['"]>\s*(\d{1,2})\s*<\/td>/i)?.[1] ?? NaN);
  if (!date || main.length !== 6 || !Number.isInteger(additional)) return null;
  return { date, drawNo, main, additional };
}

async function mapBatches(items, batchSize, mapper) {
  const rows = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    rows.push(...(await Promise.all(batch.map(mapper))));
    process.stdout.write(`\rchecked ${Math.min(i + batch.length, items.length)} / ${items.length}`);
  }
  process.stdout.write("\n");
  return rows;
}

async function buildFourD(start, end) {
  const drawNumbers = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  const rows = (
    await mapBatches(drawNumbers, 8, async (drawNo) => {
      try {
        const html = await fetchText(`https://www.singaporepools.com.sg/en/4d/pages/results.aspx?sppl=${drawParam(drawNo)}`);
        return parseFourD(html, drawNo);
      } catch {
        return null;
      }
    })
  ).filter(Boolean);

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.drawNo - b.drawNo);
  const lines = ["date,draw_no,first,second,third,starter,consolation"];
  rows.forEach((row) => lines.push([row.date, row.drawNo, row.first, row.second, row.third, row.starter.join(" "), row.consolation.join(" ")].map(csvCell).join(",")));
  return { game: "4d", rows: rows.length, csv: lines.join("\n") };
}

async function buildToto(start, end, currentFormatOnly) {
  const drawNumbers = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  const rows = (
    await mapBatches(drawNumbers, 10, async (drawNo) => {
      try {
        const html = await fetchText(`https://www.singaporepools.com.sg/en/product/sr/pages/toto_results.aspx?sppl=${drawParam(drawNo)}`);
        const row = parseToto(html, drawNo);
        if (!row) return null;
        if (currentFormatOnly && (row.main.some((n) => n > 49) || row.additional > 49 || row.date < "2014-10-01")) return null;
        return row;
      } catch {
        return null;
      }
    })
  ).filter(Boolean);

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.drawNo - b.drawNo);
  const lines = ["date,draw_no,n1,n2,n3,n4,n5,n6,additional"];
  rows.forEach((row) => lines.push([row.date, row.drawNo, ...row.main, row.additional].map(csvCell).join(",")));
  return { game: "toto", rows: rows.length, csv: lines.join("\n") };
}

async function writeDataset(name, payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, `${name}.csv`), payload.csv, "utf8");
  await fs.writeFile(
    path.join(DATA_DIR, `${name}.meta.json`),
    JSON.stringify(
      {
        game: payload.game,
        source: "singaporepools.com.sg",
        rows: payload.rows,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`${name}: wrote ${payload.rows} rows`);
}

async function main() {
  const game = arg("game", "all");
  const fourDStart = Number(arg("4d-start", "1"));
  const fourDEnd = Number(arg("4d-end", "5478"));
  const totoStart = Number(arg("toto-start", "1"));
  const totoEnd = Number(arg("toto-end", "4178"));
  const currentFormatOnly = arg("toto-current-format-only", "true") !== "false";

  if (game === "all" || game === "4d") {
    console.log(`4d: official draw scan ${fourDStart} to ${fourDEnd}`);
    await writeDataset("4d", await buildFourD(fourDStart, fourDEnd));
  }

  if (game === "all" || game === "toto") {
    console.log(`toto: official draw scan ${totoStart} to ${totoEnd}${currentFormatOnly ? " (current 6/49 era only)" : ""}`);
    await writeDataset("toto", await buildToto(totoStart, totoEnd, currentFormatOnly));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
