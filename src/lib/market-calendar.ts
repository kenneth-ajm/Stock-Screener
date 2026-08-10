function isoDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function shiftIsoDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return isoDate(year, month, 1 + offset + (nth - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return isoDate(year, month, last.getUTCDate() - offset);
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() - 1);
  if (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

// Gregorian Easter calculation, used because NYSE closes on Good Friday.
function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

export function usMarketHolidays(year: number) {
  const goodFriday = shiftIsoDate(easterSunday(year), -2);
  return new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    goodFriday,
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);
}

export function isUsMarketTradingDay(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const weekday = value.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !usMarketHolidays(value.getUTCFullYear()).has(date);
}

export function previousUsMarketTradingDay(date: string) {
  let candidate = shiftIsoDate(date, -1);
  while (!isUsMarketTradingDay(candidate)) candidate = shiftIsoDate(candidate, -1);
  return candidate;
}

export function latestCompletedUsTradingDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour") || "0");
  if (isUsMarketTradingDay(today) && hour >= 18) return today;
  return previousUsMarketTradingDay(today);
}

export function marketSessionsBehind(actual: string | null, expected: string) {
  if (!actual) return null;
  if (actual >= expected) return 0;
  let sessions = 0;
  let cursor = actual;
  while (cursor < expected && sessions < 100) {
    cursor = shiftIsoDate(cursor, 1);
    if (isUsMarketTradingDay(cursor)) sessions += 1;
  }
  return sessions;
}
