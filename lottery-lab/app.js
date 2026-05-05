const FOUR_D_SAMPLE = `date,draw_no,first,second,third,starter,consolation
2026-01-03,5401,1234,5678,9012,"1111 2222 3333","4444 5555 6666"
2026-01-07,5402,2345,6789,0123,"7777 8888 9999","1357 2468 3690"`;

const TOTO_SAMPLE = `date,draw_no,n1,n2,n3,n4,n5,n6,additional
2026-01-05,4101,3,8,12,19,33,45,27
2026-01-08,4102,1,10,14,25,38,49,6`;

const FOUR_D_BACKTEST_LIMIT = 220;
const TOTO_BACKTEST_LIMIT = 220;

function parseDelimited(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && (ch === "," || ch === "\t" || ch === ";")) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const ymd = raw.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  const dmy = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.]((?:20|19)\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function findDate(cells) {
  for (const cell of cells) {
    const date = normalizeDate(cell);
    if (date) return date;
  }
  return null;
}

function findHeaderIndex(headers, patterns) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function numbers4D(value) {
  return Array.from(String(value).matchAll(/\b\d{4}\b/g)).map((match) => match[0]);
}

function numbersToto(value) {
  return Array.from(String(value).matchAll(/\b\d{1,2}\b/g))
    .map((match) => Number(match[0]))
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 49);
}

function sortedByDate(draws) {
  return [...draws].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    return dateCmp !== 0 ? dateCmp : String(a.drawNo || "").localeCompare(String(b.drawNo || ""));
  });
}

function parseFourDHistory(text) {
  const errors = [];
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (rawLines.length === 0) return { draws: [], errors };

  const firstCells = parseDelimited(rawLines[0]);
  const headers = firstCells.map((cell) => cell.toLowerCase());
  const hasHeader = headers.some((header) => /date|draw|first|1st|second|2nd|third|3rd/.test(header));
  const lines = hasHeader ? rawLines.slice(1) : rawLines;
  const dateIdx = hasHeader ? findHeaderIndex(headers, [/date/]) : -1;
  const drawIdx = hasHeader ? findHeaderIndex(headers, [/draw/]) : -1;
  const firstIdx = hasHeader ? findHeaderIndex(headers, [/^first$/, /1st/, /first prize/]) : -1;
  const secondIdx = hasHeader ? findHeaderIndex(headers, [/^second$/, /2nd/, /second prize/]) : -1;
  const thirdIdx = hasHeader ? findHeaderIndex(headers, [/^third$/, /3rd/, /third prize/]) : -1;

  const draws = [];
  lines.forEach((line, lineIndex) => {
    const cells = parseDelimited(line);
    const date = dateIdx >= 0 ? normalizeDate(cells[dateIdx]) : findDate(cells);
    const allNumbers = numbers4D(cells.join(" "));
    let top = allNumbers.slice(0, 3);
    if (firstIdx >= 0 && secondIdx >= 0 && thirdIdx >= 0) {
      top = [numbers4D(cells[firstIdx])[0], numbers4D(cells[secondIdx])[0], numbers4D(cells[thirdIdx])[0]].filter(Boolean);
    }
    if (!date || top.length < 3) {
      errors.push(`Skipped 4D row ${lineIndex + 1}: expected date plus first, second, and third prize.`);
      return;
    }
    const topSet = new Set(top);
    draws.push({
      date,
      drawNo: drawIdx >= 0 ? String(cells[drawIdx] || "").trim() || undefined : undefined,
      first: top[0],
      second: top[1],
      third: top[2],
      others: allNumbers.filter((number) => !topSet.has(number)),
    });
  });

  return { draws: sortedByDate(draws), errors };
}

function parseTotoHistory(text) {
  const errors = [];
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (rawLines.length === 0) return { draws: [], errors };

  const firstCells = parseDelimited(rawLines[0]);
  const headers = firstCells.map((cell) => cell.toLowerCase());
  const hasHeader = headers.some((header) => /date|draw|n1|winning|additional/.test(header));
  const lines = hasHeader ? rawLines.slice(1) : rawLines;
  const dateIdx = hasHeader ? findHeaderIndex(headers, [/date/]) : -1;
  const drawIdx = hasHeader ? findHeaderIndex(headers, [/draw/]) : -1;
  const additionalIdx = hasHeader ? findHeaderIndex(headers, [/additional/, /bonus/]) : -1;

  const draws = [];
  lines.forEach((line, lineIndex) => {
    const cells = parseDelimited(line);
    const date = dateIdx >= 0 ? normalizeDate(cells[dateIdx]) : findDate(cells);
    const allNumbers = numbersToto(cells.join(" "));
    const main = Array.from(new Set(allNumbers.slice(0, 6))).sort((a, b) => a - b);
    const additional = additionalIdx >= 0 ? numbersToto(cells[additionalIdx])[0] || null : allNumbers[6] || null;
    if (!date || main.length < 6) {
      errors.push(`Skipped TOTO row ${lineIndex + 1}: expected date plus six winning numbers.`);
      return;
    }
    draws.push({
      date,
      drawNo: drawIdx >= 0 ? String(cells[drawIdx] || "").trim() || undefined : undefined,
      main,
      additional,
    });
  });

  return { draws: sortedByDate(draws), errors };
}

function hashTie(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function top3List(draw) {
  return [draw.first, draw.second, draw.third];
}

function buildFourDStats(draws) {
  const stats = new Map();
  const recentTop3 = draws.slice(-160).flatMap(top3List);
  const positionCounts = Array.from({ length: 4 }, () => Array.from({ length: 10 }, () => 0));
  const firstTwo = new Map();
  const lastTwo = new Map();

  function get(number) {
    if (stats.has(number)) return stats.get(number);
    const next = { top3: 0, all: 0, first: 0, second: 0, third: 0, lastIndex: -1, lastTop3Date: null };
    stats.set(number, next);
    return next;
  }

  draws.forEach((draw, index) => {
    top3List(draw).forEach((number, prizeIndex) => {
      const row = get(number);
      row.top3 += 1;
      row.all += 1;
      row.lastIndex = index;
      row.lastTop3Date = draw.date;
      if (prizeIndex === 0) row.first += 1;
      if (prizeIndex === 1) row.second += 1;
      if (prizeIndex === 2) row.third += 1;
    });
    draw.others.forEach((number) => {
      const row = get(number);
      row.all += 1;
      row.lastIndex = Math.max(row.lastIndex, index);
    });
  });

  recentTop3.forEach((number) => {
    number.split("").forEach((digit, index) => {
      positionCounts[index][Number(digit)] += 1;
    });
    firstTwo.set(number.slice(0, 2), (firstTwo.get(number.slice(0, 2)) || 0) + 1);
    lastTwo.set(number.slice(2), (lastTwo.get(number.slice(2)) || 0) + 1);
  });

  return { stats, positionCounts, firstTwo, lastTwo, recentTop3Count: Math.max(1, recentTop3.length) };
}

function scoreFourD(draws) {
  const { stats, positionCounts, firstTwo, lastTwo, recentTop3Count } = buildFourDStats(draws);
  const latestIndex = draws.length - 1;
  const candidates = [];

  for (let value = 0; value <= 9999; value++) {
    const number = String(value).padStart(4, "0");
    const stat = stats.get(number);
    const digits = number.split("").map(Number);
    const uniqueDigits = new Set(digits).size;
    const age = !stat || stat.lastIndex < 0 ? draws.length + 100 : latestIndex - stat.lastIndex;
    let score = 0;
    const reasons = [];

    if (stat) {
      score += stat.first * 8 + stat.second * 5 + stat.third * 4 + Math.max(0, stat.all - stat.top3) * 0.7;
      score += 4 * Math.exp(-Math.max(0, age) / 70);
      if (stat.top3 > 0) reasons.push(`${stat.top3} historical top-3 hit${stat.top3 === 1 ? "" : "s"}`);
      if (stat.lastTop3Date) reasons.push(`last top-3 seen ${stat.lastTop3Date}`);
    } else {
      reasons.push("no exact historical top-3 hit in the imported file");
    }

    digits.forEach((digit, index) => {
      score += (positionCounts[index][digit] / recentTop3Count) * 7;
    });
    score += ((firstTwo.get(number.slice(0, 2)) || 0) / recentTop3Count) * 9;
    score += ((lastTwo.get(number.slice(2)) || 0) / recentTop3Count) * 9;
    if (uniqueDigits >= 3) score += 1.2;
    if (uniqueDigits === 1) score -= 2.5;
    if (age < 6) score -= 3.5;
    else if (age < 18) score -= 1.2;
    score += hashTie(number) * 0.001;
    reasons.push(`${uniqueDigits} distinct digit${uniqueDigits === 1 ? "" : "s"}`);
    candidates.push({ number, score, reasons });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function diversifyFourD(candidates, count = 3) {
  const selected = [];
  for (const candidate of candidates) {
    const signature = candidate.number.split("").sort().join("");
    const tooSimilar = selected.some((pick) => pick.number.slice(2) === candidate.number.slice(2) || pick.number.split("").sort().join("") === signature);
    if (!tooSimilar) selected.push(candidate);
    if (selected.length === count) return selected;
  }
  return candidates.slice(0, count);
}

function backtestFourD(draws) {
  const start = Math.max(30, draws.length - FOUR_D_BACKTEST_LIMIT);
  let testedDraws = 0;
  let top3Hits = 0;
  for (let i = start; i < draws.length; i++) {
    const training = draws.slice(0, i);
    if (training.length < 30) continue;
    const picks = diversifyFourD(scoreFourD(training), 3);
    const winning = new Set(top3List(draws[i]));
    if (picks.some((pick) => winning.has(pick.number))) top3Hits += 1;
    testedDraws += 1;
  }
  return {
    testedDraws,
    top3Hits,
    hitRatePct: testedDraws ? (top3Hits / testedDraws) * 100 : 0,
    randomExpectedHits: testedDraws * (9 / 10000),
  };
}

function analyzeFourD(drawsInput) {
  const draws = sortedByDate(drawsInput);
  const ranked = draws.length ? scoreFourD(draws) : [];
  const hotTop3 = Array.from(buildFourDStats(draws).stats.entries())
    .map(([number, stat]) => ({ number, count: stat.top3, lastSeen: stat.lastTop3Date }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")))
    .slice(0, 8);
  return {
    drawCount: draws.length,
    latestDate: draws.at(-1)?.date || null,
    picks: diversifyFourD(ranked, 3),
    hotTop3,
    backtest: backtestFourD(draws),
  };
}

function combinations(items, size) {
  const result = [];
  const combo = [];
  function walk(start) {
    if (combo.length === size) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i <= items.length - (size - combo.length); i++) {
      combo.push(items[i]);
      walk(i + 1);
      combo.pop();
    }
  }
  walk(0);
  return result;
}

function buildTotoScores(draws) {
  const numberStats = Array.from({ length: 50 }, () => ({ main: 0, additional: 0, lastIndex: -1, lastSeen: null }));
  const pairScores = new Map();
  const latestIndex = draws.length - 1;
  draws.forEach((draw, drawIndex) => {
    const recency = Math.exp(-(latestIndex - drawIndex) / 80);
    draw.main.forEach((number) => {
      numberStats[number].main += 1 + recency;
      numberStats[number].lastIndex = drawIndex;
      numberStats[number].lastSeen = draw.date;
    });
    if (draw.additional) numberStats[draw.additional].additional += 0.5 + recency * 0.3;
    for (let a = 0; a < draw.main.length; a++) {
      for (let b = a + 1; b < draw.main.length; b++) {
        const key = `${draw.main[a]}-${draw.main[b]}`;
        pairScores.set(key, (pairScores.get(key) || 0) + 0.8 + recency);
      }
    }
  });

  const numberScores = numberStats.map((stat, number) => {
    if (number === 0) return 0;
    const age = stat.lastIndex < 0 ? draws.length + 100 : latestIndex - stat.lastIndex;
    return stat.main * 1.4 + stat.additional * 0.4 + Math.exp(-age / 55) * 2 + hashTie(String(number)) * 0.001;
  });
  return { numberScores, numberStats, pairScores };
}

function scoreToto(draws) {
  const { numberScores, numberStats, pairScores } = buildTotoScores(draws);
  const pool = Array.from({ length: 49 }, (_, index) => index + 1)
    .sort((a, b) => numberScores[b] - numberScores[a])
    .slice(0, 20)
    .sort((a, b) => a - b);
  const additionalLean = Array.from({ length: 49 }, (_, index) => index + 1).sort(
    (a, b) => numberStats[b].additional - numberStats[a].additional || numberScores[b] - numberScores[a],
  )[0];

  return combinations(pool, 6)
    .map((numbers) => {
      let score = numbers.reduce((sum, number) => sum + numberScores[number], 0);
      for (let a = 0; a < numbers.length; a++) {
        for (let b = a + 1; b < numbers.length; b++) score += (pairScores.get(`${numbers[a]}-${numbers[b]}`) || 0) * 0.22;
      }
      const oddCount = numbers.filter((number) => number % 2 === 1).length;
      const sum = numbers.reduce((acc, number) => acc + number, 0);
      const decades = new Map();
      numbers.forEach((number) => decades.set(Math.floor((number - 1) / 10), (decades.get(Math.floor((number - 1) / 10)) || 0) + 1));
      const maxDecade = Math.max(...decades.values());
      let longestRun = 1;
      let run = 1;
      for (let i = 1; i < numbers.length; i++) {
        run = numbers[i] === numbers[i - 1] + 1 ? run + 1 : 1;
        longestRun = Math.max(longestRun, run);
      }
      if (oddCount < 2 || oddCount > 4) score -= 4;
      if (sum < 95 || sum > 205) score -= 3;
      if (maxDecade > 3) score -= (maxDecade - 3) * 2;
      if (longestRun > 2) score -= (longestRun - 2) * 2;
      if (numbers[5] - numbers[0] < 24) score -= 2;
      return {
        numbers,
        score,
        additionalLean,
        reasons: [
          "weighted by main-number frequency, recency, and recurring pairs",
          "penalized for extreme odd/even, sum, decade, and consecutive clustering",
        ],
      };
    })
    .sort((a, b) => b.score - a.score);
}

function diversifyToto(candidates, count = 3) {
  const selected = [];
  for (const candidate of candidates) {
    if (!selected.some((pick) => candidate.numbers.filter((number) => pick.numbers.includes(number)).length > 3)) selected.push(candidate);
    if (selected.length === count) return selected;
  }
  return candidates.slice(0, count);
}

function backtestToto(draws) {
  const start = Math.max(30, draws.length - TOTO_BACKTEST_LIMIT);
  let testedDraws = 0;
  let groupOneHits = 0;
  let bestMatchTotal = 0;
  for (let i = start; i < draws.length; i++) {
    const training = draws.slice(0, i);
    if (training.length < 30) continue;
    const picks = diversifyToto(scoreToto(training), 3);
    const winning = new Set(draws[i].main);
    const bestMatches = Math.max(...picks.map((pick) => pick.numbers.filter((number) => winning.has(number)).length));
    if (bestMatches === 6) groupOneHits += 1;
    bestMatchTotal += bestMatches;
    testedDraws += 1;
  }
  return {
    testedDraws,
    groupOneHits,
    averageBestMatches: testedDraws ? bestMatchTotal / testedDraws : 0,
    randomExpectedGroupOneHits: testedDraws * (3 / 13983816),
  };
}

function analyzeToto(drawsInput) {
  const draws = sortedByDate(drawsInput);
  const { numberStats } = buildTotoScores(draws);
  return {
    drawCount: draws.length,
    latestDate: draws.at(-1)?.date || null,
    picks: draws.length ? diversifyToto(scoreToto(draws), 3) : [],
    hotNumbers: numberStats
      .map((stat, number) => ({ number, count: stat.main, lastSeen: stat.lastSeen }))
      .filter((row) => row.number > 0 && row.count > 0)
      .sort((a, b) => b.count - a.count || String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")))
      .slice(0, 10),
    backtest: backtestToto(draws),
  };
}

function fixed(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function pct(value) {
  return `${fixed(value, 2)}%`;
}

function metric(label, value, detail) {
  return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail || ""}</div></div>`;
}

function renderErrors(target, errors) {
  target.hidden = errors.length === 0;
  target.innerHTML = errors.length ? `<strong>Rows skipped</strong><br>${errors.slice(0, 6).join("<br>")}${errors.length > 6 ? `<br>Plus ${errors.length - 6} more.` : ""}` : "";
}

function setStatus(id, message) {
  document.querySelector(id).innerHTML = message;
}

async function loadArchive({ game, inputSelector, statusSelector, buttonSelector, resultSelector, parse, analyze, render }) {
  const button = document.querySelector(buttonSelector);
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Loading...";
  setStatus(statusSelector, "Loading full cached official history from this app. No live scraping needed.");

  try {
    const [csvResponse, metaResponse] = await Promise.all([fetch(`/data/${game}.csv`), fetch(`/data/${game}.meta.json`)]);
    if (!csvResponse.ok) throw new Error(`Cached history request failed with status ${csvResponse.status}`);
    const csv = await csvResponse.text();
    const meta = metaResponse.ok ? await metaResponse.json() : null;

    const input = document.querySelector(inputSelector);
    input.value = csv;
    updateParseNotes();
    const parsed = parse(csv);
    document.querySelector(resultSelector).innerHTML = parsed.draws.length
      ? render(analyze(parsed.draws))
      : `<div class="empty">The archive loaded but no valid rows were parsed.</div>`;
    setStatus(
      statusSelector,
      `<strong>Loaded ${parsed.draws.length} ${game.toUpperCase()} draws</strong> from cached ${meta?.source || "official"} history${meta?.generatedAt ? ` generated ${meta.generatedAt.slice(0, 10)}` : ""}.`,
    );
  } catch (error) {
    setStatus(statusSelector, `<strong>Cached history load failed.</strong> ${error instanceof Error ? error.message : String(error)} You can still paste CSV manually.`);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function renderFourD(analysis) {
  const pickCards = analysis.picks
    .map(
      (pick, index) => `<article class="pick-card">
        <div class="pick-head"><div class="label">Set ${index + 1}</div><div class="score">score ${fixed(pick.score, 1)}</div></div>
        <div class="four-d-number">${pick.number}</div>
        <div class="reason-list">${pick.reasons.slice(0, 3).map((reason) => `<span>${reason}</span>`).join("")}</div>
      </article>`,
    )
    .join("");
  const hotRows = analysis.hotTop3
    .map((row) => `<div class="hot-row"><strong class="mono">${row.number}</strong><span>${row.count} hits</span></div>`)
    .join("");

  return `<div class="metrics">
      ${metric("Draws Imported", analysis.drawCount, analysis.latestDate ? `Latest ${analysis.latestDate}` : "No latest date")}
      ${metric("Backtest Window", analysis.backtest.testedDraws, "Rolling one-draw-ahead tests")}
      ${metric("Top-3 Hits", analysis.backtest.top3Hits, `${pct(analysis.backtest.hitRatePct)} hit rate`)}
      ${metric("Random Baseline", fixed(analysis.backtest.randomExpectedHits, 3), "Expected hits for 3 exact tickets")}
    </div>
    <div class="picks">${pickCards}</div>
    <article class="hot-card">
      <h2>Most Frequent Imported Top-3 Numbers</h2>
      <div class="hot-grid">${hotRows || "<p class='detail'>No top-3 frequency yet.</p>"}</div>
    </article>`;
}

function renderToto(analysis) {
  const pickCards = analysis.picks
    .map(
      (pick, index) => `<article class="pick-card">
        <div class="pick-head"><div class="label">Set ${index + 1}</div><div class="score">score ${fixed(pick.score, 1)}</div></div>
        <div class="balls">${pick.numbers.map((number) => `<span class="ball">${number}</span>`).join("")}</div>
        <div class="detail">Additional lean: <strong>${pick.additionalLean || "n/a"}</strong></div>
        <div class="reason-list">${pick.reasons.map((reason) => `<span>${reason}</span>`).join("")}</div>
      </article>`,
    )
    .join("");
  const hotRows = analysis.hotNumbers
    .map((row) => `<div class="hot-row"><strong>${row.number}</strong><span>${fixed(row.count, 1)} score</span></div>`)
    .join("");

  return `<div class="metrics">
      ${metric("Draws Imported", analysis.drawCount, analysis.latestDate ? `Latest ${analysis.latestDate}` : "No latest date")}
      ${metric("Backtest Window", analysis.backtest.testedDraws, "Rolling one-draw-ahead tests")}
      ${metric("Group 1 Hits", analysis.backtest.groupOneHits, "Six main numbers matched")}
      ${metric("Best Avg Match", fixed(analysis.backtest.averageBestMatches, 2), "Best of 3 sets per tested draw")}
    </div>
    <div class="picks">${pickCards}</div>
    <article class="hot-card">
      <h2>Most Frequent Imported TOTO Main Numbers</h2>
      <div class="hot-grid">${hotRows || "<p class='detail'>No main-number frequency yet.</p>"}</div>
      <div class="detail">Random Group 1 baseline for this backtest window: ${fixed(analysis.backtest.randomExpectedGroupOneHits, 6)} expected hits.</div>
    </article>`;
}

function updateParseNotes() {
  const fourDParsed = parseFourDHistory(document.querySelector("#fourD-input").value);
  document.querySelector("#fourD-parse-note").textContent = `Parsed ${fourDParsed.draws.length} draws. ${fourDParsed.errors.length ? `${fourDParsed.errors.length} skipped rows.` : "No skipped rows."}`;
  renderErrors(document.querySelector("#fourD-errors"), fourDParsed.errors);

  const totoParsed = parseTotoHistory(document.querySelector("#toto-input").value);
  document.querySelector("#toto-parse-note").textContent = `Parsed ${totoParsed.draws.length} draws. ${totoParsed.errors.length ? `${totoParsed.errors.length} skipped rows.` : "No skipped rows."}`;
  renderErrors(document.querySelector("#toto-errors"), totoParsed.errors);
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelector("#fourD-panel").classList.toggle("active", button.dataset.tab === "fourD");
    document.querySelector("#toto-panel").classList.toggle("active", button.dataset.tab === "toto");
  });
});

document.querySelector("#fourD-sample").addEventListener("click", () => {
  document.querySelector("#fourD-input").value = FOUR_D_SAMPLE;
  setStatus("#fourD-status", "Sample format loaded. This is only two example rows, not real history.");
  updateParseNotes();
});

document.querySelector("#toto-sample").addEventListener("click", () => {
  document.querySelector("#toto-input").value = TOTO_SAMPLE;
  setStatus("#toto-status", "Sample format loaded. This is only two example rows, not real history.");
  updateParseNotes();
});

document.querySelector("#fourD-archive").addEventListener("click", () => {
  loadArchive({
    game: "4d",
    inputSelector: "#fourD-input",
    statusSelector: "#fourD-status",
    buttonSelector: "#fourD-archive",
    resultSelector: "#fourD-results",
    parse: parseFourDHistory,
    analyze: analyzeFourD,
    render: renderFourD,
  });
});

document.querySelector("#toto-archive").addEventListener("click", () => {
  loadArchive({
    game: "toto",
    inputSelector: "#toto-input",
    statusSelector: "#toto-status",
    buttonSelector: "#toto-archive",
    resultSelector: "#toto-results",
    parse: parseTotoHistory,
    analyze: analyzeToto,
    render: renderToto,
  });
});

document.querySelector("#fourD-input").addEventListener("input", updateParseNotes);
document.querySelector("#toto-input").addEventListener("input", updateParseNotes);

document.querySelector("#fourD-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const parsed = parseFourDHistory(document.querySelector("#fourD-input").value);
  renderErrors(document.querySelector("#fourD-errors"), parsed.errors);
  document.querySelector("#fourD-results").innerHTML = parsed.draws.length
    ? renderFourD(analyzeFourD(parsed.draws))
    : `<div class="empty">No valid 4D draws found. Paste rows with a date plus first, second, and third prize.</div>`;
});

document.querySelector("#toto-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const parsed = parseTotoHistory(document.querySelector("#toto-input").value);
  renderErrors(document.querySelector("#toto-errors"), parsed.errors);
  document.querySelector("#toto-results").innerHTML = parsed.draws.length
    ? renderToto(analyzeToto(parsed.draws))
    : `<div class="empty">No valid TOTO draws found. Paste rows with a date plus six winning numbers.</div>`;
});

updateParseNotes();
