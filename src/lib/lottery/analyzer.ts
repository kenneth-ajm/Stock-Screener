export type FourDDraw = {
  date: string;
  drawNo?: string;
  first: string;
  second: string;
  third: string;
  others: string[];
};

export type TotoDraw = {
  date: string;
  drawNo?: string;
  main: number[];
  additional?: number | null;
};

export type ParsedLottery<T> = {
  draws: T[];
  errors: string[];
};

export type FourDPick = {
  number: string;
  score: number;
  reasons: string[];
};

export type TotoPick = {
  numbers: number[];
  additionalLean: number | null;
  score: number;
  reasons: string[];
};

export type FourDAnalysis = {
  drawCount: number;
  latestDate: string | null;
  picks: FourDPick[];
  hotTop3: Array<{ number: string; count: number; lastSeen: string | null }>;
  backtest: {
    testedDraws: number;
    top3Hits: number;
    hitRatePct: number;
    randomExpectedHits: number;
  };
};

export type TotoAnalysis = {
  drawCount: number;
  latestDate: string | null;
  picks: TotoPick[];
  hotNumbers: Array<{ number: number; count: number; lastSeen: string | null }>;
  backtest: {
    testedDraws: number;
    groupOneHits: number;
    averageBestMatches: number;
    randomExpectedGroupOneHits: number;
  };
};

type FourDStats = {
  top3: number;
  all: number;
  first: number;
  second: number;
  third: number;
  lastIndex: number;
  lastTop3Date: string | null;
};

const FOUR_D_BACKTEST_LIMIT = 220;
const TOTO_BACKTEST_LIMIT = 220;

function parseDelimited(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === "," || ch === "\t" || ch === ";")) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeDate(value: string) {
  const raw = value.trim();
  const ymd = raw.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;

  const dmy = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.]((?:20|19)\d{2})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function findDate(cells: string[]) {
  for (const cell of cells) {
    const normalized = normalizeDate(cell);
    if (normalized) return normalized;
  }
  return null;
}

function findHeaderIndex(headers: string[], patterns: RegExp[]) {
  return headers.findIndex((h) => patterns.some((pattern) => pattern.test(h)));
}

function numbers4D(value: string) {
  return Array.from(value.matchAll(/\b\d{4}\b/g)).map((m) => m[0]);
}

function numbersToto(value: string) {
  return Array.from(value.matchAll(/\b\d{1,2}\b/g))
    .map((m) => Number(m[0]))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 49);
}

function sortedByDate<T extends { date: string; drawNo?: string }>(draws: T[]) {
  return [...draws].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return String(a.drawNo ?? "").localeCompare(String(b.drawNo ?? ""));
  });
}

export function parseFourDHistory(text: string): ParsedLottery<FourDDraw> {
  const errors: string[] = [];
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (rawLines.length === 0) return { draws: [], errors: [] };

  const firstCells = parseDelimited(rawLines[0]);
  const lowerHeaders = firstCells.map((cell) => cell.toLowerCase());
  const hasHeader = lowerHeaders.some((h) => /date|draw|first|1st|second|2nd|third|3rd/.test(h));
  const headers = hasHeader ? lowerHeaders : [];
  const lines = hasHeader ? rawLines.slice(1) : rawLines;

  const dateIdx = hasHeader ? findHeaderIndex(headers, [/date/]) : -1;
  const drawIdx = hasHeader ? findHeaderIndex(headers, [/draw/]) : -1;
  const firstIdx = hasHeader ? findHeaderIndex(headers, [/^first$/, /1st/, /first prize/]) : -1;
  const secondIdx = hasHeader ? findHeaderIndex(headers, [/^second$/, /2nd/, /second prize/]) : -1;
  const thirdIdx = hasHeader ? findHeaderIndex(headers, [/^third$/, /3rd/, /third prize/]) : -1;

  const draws: FourDDraw[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    const cells = parseDelimited(line);
    const date = dateIdx >= 0 ? normalizeDate(cells[dateIdx] ?? "") : findDate(cells);
    const allNumbers = numbers4D(cells.join(" "));
    let top = allNumbers.slice(0, 3);

    if (firstIdx >= 0 && secondIdx >= 0 && thirdIdx >= 0) {
      top = [
        numbers4D(cells[firstIdx] ?? "")[0],
        numbers4D(cells[secondIdx] ?? "")[0],
        numbers4D(cells[thirdIdx] ?? "")[0],
      ].filter(Boolean);
    }

    if (!date || top.length < 3) {
      errors.push(`Skipped 4D row ${lineIndex + 1}: expected date plus first, second, and third prize.`);
      continue;
    }

    const topSet = new Set(top);
    draws.push({
      date,
      drawNo: drawIdx >= 0 ? String(cells[drawIdx] ?? "").trim() || undefined : undefined,
      first: top[0],
      second: top[1],
      third: top[2],
      others: allNumbers.filter((n) => !topSet.has(n)),
    });
  }

  return { draws: sortedByDate(draws), errors };
}

export function parseTotoHistory(text: string): ParsedLottery<TotoDraw> {
  const errors: string[] = [];
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (rawLines.length === 0) return { draws: [], errors: [] };

  const firstCells = parseDelimited(rawLines[0]);
  const lowerHeaders = firstCells.map((cell) => cell.toLowerCase());
  const hasHeader = lowerHeaders.some((h) => /date|draw|n1|winning|additional/.test(h));
  const headers = hasHeader ? lowerHeaders : [];
  const lines = hasHeader ? rawLines.slice(1) : rawLines;

  const dateIdx = hasHeader ? findHeaderIndex(headers, [/date/]) : -1;
  const drawIdx = hasHeader ? findHeaderIndex(headers, [/draw/]) : -1;
  const additionalIdx = hasHeader ? findHeaderIndex(headers, [/additional/, /bonus/]) : -1;

  const draws: TotoDraw[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    const cells = parseDelimited(line);
    const date = dateIdx >= 0 ? normalizeDate(cells[dateIdx] ?? "") : findDate(cells);
    const allNumbers = numbersToto(cells.join(" "));
    const main = allNumbers.slice(0, 6);
    const additional = additionalIdx >= 0 ? numbersToto(cells[additionalIdx] ?? "")[0] ?? null : allNumbers[6] ?? null;

    if (!date || main.length < 6) {
      errors.push(`Skipped TOTO row ${lineIndex + 1}: expected date plus six winning numbers.`);
      continue;
    }

    draws.push({
      date,
      drawNo: drawIdx >= 0 ? String(cells[drawIdx] ?? "").trim() || undefined : undefined,
      main: Array.from(new Set(main)).sort((a, b) => a - b),
      additional,
    });
  }

  return { draws: sortedByDate(draws), errors };
}

function hashTie(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function top3List(draw: FourDDraw) {
  return [draw.first, draw.second, draw.third];
}

function buildFourDStats(draws: FourDDraw[]) {
  const stats = new Map<string, FourDStats>();
  const recentTop3 = draws.slice(-160).flatMap(top3List);
  const positionCounts = Array.from({ length: 4 }, () => Array.from({ length: 10 }, () => 0));
  const firstTwo = new Map<string, number>();
  const lastTwo = new Map<string, number>();

  function get(number: string) {
    const existing = stats.get(number);
    if (existing) return existing;
    const next = { top3: 0, all: 0, first: 0, second: 0, third: 0, lastIndex: -1, lastTop3Date: null };
    stats.set(number, next);
    return next;
  }

  draws.forEach((draw, index) => {
    const top = top3List(draw);
    top.forEach((number, prizeIndex) => {
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
    firstTwo.set(number.slice(0, 2), (firstTwo.get(number.slice(0, 2)) ?? 0) + 1);
    lastTwo.set(number.slice(2), (lastTwo.get(number.slice(2)) ?? 0) + 1);
  });

  return { stats, positionCounts, firstTwo, lastTwo, recentTop3Count: Math.max(1, recentTop3.length) };
}

function scoreFourD(draws: FourDDraw[]) {
  const { stats, positionCounts, firstTwo, lastTwo, recentTop3Count } = buildFourDStats(draws);
  const latestIndex = draws.length - 1;
  const candidates: FourDPick[] = [];

  for (let value = 0; value <= 9999; value++) {
    const number = value.toString().padStart(4, "0");
    const stat = stats.get(number);
    const digits = number.split("").map(Number);
    const uniqueDigits = new Set(digits).size;
    const age = stat?.lastIndex == null || stat.lastIndex < 0 ? draws.length + 100 : latestIndex - stat.lastIndex;
    let score = 0;
    const reasons: string[] = [];

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
    score += ((firstTwo.get(number.slice(0, 2)) ?? 0) / recentTop3Count) * 9;
    score += ((lastTwo.get(number.slice(2)) ?? 0) / recentTop3Count) * 9;

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

function diversifyFourD(candidates: FourDPick[], count = 3) {
  const selected: FourDPick[] = [];
  for (const candidate of candidates) {
    const signature = candidate.number.split("").sort().join("");
    const tooSimilar = selected.some((pick) => {
      const pickSignature = pick.number.split("").sort().join("");
      return pick.number.slice(2) === candidate.number.slice(2) || pickSignature === signature;
    });
    if (!tooSimilar) selected.push(candidate);
    if (selected.length === count) return selected;
  }
  return candidates.slice(0, count);
}

export function analyzeFourD(drawsInput: FourDDraw[]): FourDAnalysis {
  const draws = sortedByDate(drawsInput);
  const ranked = draws.length ? scoreFourD(draws) : [];
  const picks = diversifyFourD(ranked, 3);
  const hotTop3 = [...buildFourDStats(draws).stats.entries()]
    .map(([number, stat]) => ({ number, count: stat.top3, lastSeen: stat.lastTop3Date }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? "")))
    .slice(0, 8);

  return {
    drawCount: draws.length,
    latestDate: draws.at(-1)?.date ?? null,
    picks,
    hotTop3,
    backtest: backtestFourD(draws),
  };
}

function backtestFourD(draws: FourDDraw[]) {
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

function combinations<T>(items: T[], size: number) {
  const result: T[][] = [];
  const combo: T[] = [];
  function walk(start: number) {
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

function buildTotoScores(draws: TotoDraw[]) {
  const numberStats = Array.from({ length: 50 }, () => ({ main: 0, additional: 0, lastIndex: -1, lastSeen: null as string | null }));
  const pairScores = new Map<string, number>();
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
        pairScores.set(key, (pairScores.get(key) ?? 0) + 0.8 + recency);
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

function scoreToto(draws: TotoDraw[]) {
  const { numberScores, numberStats, pairScores } = buildTotoScores(draws);
  const pool = Array.from({ length: 49 }, (_, index) => index + 1)
    .sort((a, b) => numberScores[b] - numberScores[a])
    .slice(0, 20)
    .sort((a, b) => a - b);

  const candidates = combinations(pool, 6).map((numbers) => {
    let score = numbers.reduce((sum, n) => sum + numberScores[n], 0);
    for (let a = 0; a < numbers.length; a++) {
      for (let b = a + 1; b < numbers.length; b++) {
        score += (pairScores.get(`${numbers[a]}-${numbers[b]}`) ?? 0) * 0.22;
      }
    }

    const oddCount = numbers.filter((n) => n % 2 === 1).length;
    const sum = numbers.reduce((acc, n) => acc + n, 0);
    const decades = new Map<number, number>();
    numbers.forEach((n) => decades.set(Math.floor((n - 1) / 10), (decades.get(Math.floor((n - 1) / 10)) ?? 0) + 1));
    const maxDecade = Math.max(...decades.values());
    let longestRun = 1;
    let run = 1;
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] === numbers[i - 1] + 1) run += 1;
      else run = 1;
      longestRun = Math.max(longestRun, run);
    }

    if (oddCount < 2 || oddCount > 4) score -= 4;
    if (sum < 95 || sum > 205) score -= 3;
    if (maxDecade > 3) score -= (maxDecade - 3) * 2;
    if (longestRun > 2) score -= (longestRun - 2) * 2;
    if (numbers[5] - numbers[0] < 24) score -= 2;

    return { numbers, score };
  });

  const additionalLean =
    Array.from({ length: 49 }, (_, index) => index + 1).sort((a, b) => numberStats[b].additional - numberStats[a].additional || numberScores[b] - numberScores[a])[0] ??
    null;

  return candidates
    .sort((a, b) => b.score - a.score)
    .map<TotoPick>((candidate) => ({
      ...candidate,
      additionalLean,
      reasons: [
        "weighted by main-number frequency, recency, and recurring pairs",
        "penalized for extreme odd/even, sum, decade, and consecutive clustering",
      ],
    }));
}

function diversifyToto(candidates: TotoPick[], count = 3) {
  const selected: TotoPick[] = [];
  for (const candidate of candidates) {
    const overlapTooHigh = selected.some((pick) => candidate.numbers.filter((n) => pick.numbers.includes(n)).length > 3);
    if (!overlapTooHigh) selected.push(candidate);
    if (selected.length === count) return selected;
  }
  return candidates.slice(0, count);
}

export function analyzeToto(drawsInput: TotoDraw[]): TotoAnalysis {
  const draws = sortedByDate(drawsInput);
  const { numberStats } = buildTotoScores(draws);
  const picks = draws.length ? diversifyToto(scoreToto(draws), 3) : [];
  const hotNumbers = numberStats
    .map((stat, number) => ({ number, count: stat.main, lastSeen: stat.lastSeen }))
    .filter((row) => row.number > 0 && row.count > 0)
    .sort((a, b) => b.count - a.count || String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? "")))
    .slice(0, 10);

  return {
    drawCount: draws.length,
    latestDate: draws.at(-1)?.date ?? null,
    picks,
    hotNumbers,
    backtest: backtestToto(draws),
  };
}

function backtestToto(draws: TotoDraw[]) {
  const start = Math.max(30, draws.length - TOTO_BACKTEST_LIMIT);
  let testedDraws = 0;
  let groupOneHits = 0;
  let bestMatchTotal = 0;

  for (let i = start; i < draws.length; i++) {
    const training = draws.slice(0, i);
    if (training.length < 30) continue;
    const picks = diversifyToto(scoreToto(training), 3);
    const winning = new Set(draws[i].main);
    const bestMatches = Math.max(...picks.map((pick) => pick.numbers.filter((n) => winning.has(n)).length));
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
