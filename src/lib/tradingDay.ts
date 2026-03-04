function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getNyParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    weekday: get("weekday"),
  };
}

function prevWeekday(date: Date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export function lastCompletedUsTradingDay(now = new Date()) {
  const ny = getNyParts(now);
  const utcDateFromNy = new Date(Date.UTC(ny.year, ny.month - 1, ny.day));
  if (ny.weekday === "Sat") return ymd(prevWeekday(utcDateFromNy));
  if (ny.weekday === "Sun") return ymd(prevWeekday(prevWeekday(utcDateFromNy)));
  if (ny.hour < 18) return ymd(prevWeekday(utcDateFromNy));
  return ymd(utcDateFromNy);
}

