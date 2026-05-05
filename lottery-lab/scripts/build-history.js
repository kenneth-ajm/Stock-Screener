#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const history = require("../api/history.js");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((item) => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

function gamesArg() {
  const raw = arg("games", "4d,toto");
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function writeDataset(name, payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const csvPath = path.join(DATA_DIR, `${name}.csv`);
  const metaPath = path.join(DATA_DIR, `${name}.meta.json`);
  await fs.writeFile(csvPath, payload.csv, "utf8");
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        game: payload.game,
        source: payload.source ?? "sgresult.com",
        rows: payload.rows,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`${name}: wrote ${payload.rows} rows to ${path.relative(process.cwd(), csvPath)}`);
}

async function main() {
  const games = gamesArg();
  const fourDPages = Number(arg("4d-pages", "650"));
  const fourDMaxDraws = Number(arg("4d-max-draws", "8000"));
  const totoPages = Number(arg("toto-pages", "500"));

  if (games.includes("4d")) {
    console.log(`4d: crawling up to ${fourDPages} archive pages and ${fourDMaxDraws} draw detail pages...`);
    const payload = await history._internal.loadFourD(fourDPages, fourDMaxDraws);
    await writeDataset("4d", { ...payload, source: "sgresult.com" });
  }

  if (games.includes("toto")) {
    console.log(`toto: crawling up to ${totoPages} archive pages...`);
    const payload = await history._internal.loadToto(totoPages);
    await writeDataset("toto", { ...payload, source: "sgresult.com" });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
