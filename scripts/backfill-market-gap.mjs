import { createClient } from "@supabase/supabase-js";

const UNIVERSE_SLUGS = ["core_800", "liquid_2000", "midcap_1000", "growth_1500"];
const POLYGON_BASE = "https://api.polygon.io";
const WRITE_CHUNK = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, operation, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(JSON.stringify({ phase: "retry", label, attempt, delay_ms: delayMs, error: error instanceof Error ? error.message : String(error) }));
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function requiredEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function shiftDate(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function latestCompletedWeekday() {
  const now = new Date();
  const ny = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const parts = Object.fromEntries(ny.map((part) => [part.type, part.value]));
  let date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour ?? 0);
  if (parts.weekday === "Sat") date = shiftDate(date, -1);
  else if (parts.weekday === "Sun") date = shiftDate(date, -2);
  else if (hour < 17) date = shiftDate(date, -1);
  while ([0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) date = shiftDate(date, -1);
  return date;
}

function cliArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function dateRange(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(date);
  }
  return dates;
}

async function fetchGrouped(apiKey, date) {
  return withRetry(`polygon_grouped:${date}`, async () => {
    const url = `${POLYGON_BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=false&apiKey=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Polygon ${date} failed (${response.status}): ${json?.error ?? json?.message ?? "unknown"}`);
      return Array.isArray(json?.results) ? json.results : [];
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function activeSymbols(supabase) {
  const { data: universes, error } = await supabase.from("universes").select("id,slug").in("slug", UNIVERSE_SLUGS);
  if (error) throw error;
  const ids = new Map((universes ?? []).map((universe) => [String(universe.slug), String(universe.id)]));
  const missing = UNIVERSE_SLUGS.filter((slug) => !ids.has(slug));
  if (missing.length) throw new Error(`Missing universes: ${missing.join(", ")}`);
  const symbols = new Set(["SPY"]);
  const counts = {};
  for (const slug of UNIVERSE_SLUGS) {
    const universeSymbols = new Set();
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data: members, error: memberError } = await supabase
        .from("universe_members")
        .select("symbol")
        .eq("universe_id", ids.get(slug))
        .eq("active", true)
        .order("symbol", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (memberError) throw memberError;
      for (const member of members ?? []) {
        const symbol = String(member.symbol ?? "").trim().toUpperCase();
        if (symbol) universeSymbols.add(symbol);
      }
      if ((members?.length ?? 0) < pageSize) break;
    }
    counts[slug] = universeSymbols.size;
    for (const symbol of universeSymbols) {
      symbols.add(symbol);
    }
  }
  return { symbols, counts };
}

async function main() {
  const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const apiKey = requiredEnv("POLYGON_API_KEY");
  const { data: latestRows, error: latestError } = await supabase
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .eq("source", "polygon")
    .order("date", { ascending: false })
    .limit(1);
  if (latestError) throw latestError;
  const latest = latestRows?.[0]?.date ? String(latestRows[0].date) : null;
  const from = cliArg("from") ?? (latest ? shiftDate(latest, 1) : null);
  const to = cliArg("to") ?? latestCompletedWeekday();
  if (!from) throw new Error("No existing SPY bar found; pass --from=YYYY-MM-DD");
  if (from > to) {
    console.log(JSON.stringify({ ok: true, message: "No market-data gap", latest, target: to }, null, 2));
    return;
  }

  const universe = await activeSymbols(supabase);
  const dates = dateRange(from, to);
  const startedAt = Date.now();
  let sessionsWritten = 0;
  let rowsWritten = 0;
  const skippedDates = [];
  console.log(JSON.stringify({ phase: "start", from, to, candidate_weekdays: dates.length, unique_symbols: universe.symbols.size, universe_counts: universe.counts }));

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const grouped = await fetchGrouped(apiKey, date);
    const hasSpy = grouped.some((row) => String(row?.T ?? "").toUpperCase() === "SPY");
    if (!hasSpy) {
      skippedDates.push(date);
      console.log(JSON.stringify({ phase: "skip", date, reason: "no_SPY_grouped_bar", progress: `${index + 1}/${dates.length}` }));
      continue;
    }
    const rowsBySymbol = new Map();
    for (const groupedRow of grouped) {
      const row = {
        symbol: String(groupedRow?.T ?? "").trim().toUpperCase(),
        date,
        open: Number(groupedRow?.o),
        high: Number(groupedRow?.h),
        low: Number(groupedRow?.l),
        close: Number(groupedRow?.c),
        volume: Math.round(Number(groupedRow?.v)),
        source: "polygon",
      };
      if (
        universe.symbols.has(row.symbol) &&
        [row.open, row.high, row.low, row.close, row.volume].every((value) => Number.isFinite(value))
      ) {
        rowsBySymbol.set(row.symbol, row);
      }
    }
    const rows = Array.from(rowsBySymbol.values());
    for (let offset = 0; offset < rows.length; offset += WRITE_CHUNK) {
      const chunk = rows.slice(offset, offset + WRITE_CHUNK);
      await withRetry(`price_bars_upsert:${date}:${offset}`, async () => {
        const { error } = await supabase.from("price_bars").upsert(chunk, { onConflict: "symbol,date" });
        if (error) throw new Error(`${date} upsert failed: ${error.message}`);
      });
    }
    sessionsWritten += 1;
    rowsWritten += rows.length;
    console.log(JSON.stringify({ phase: "write", date, rows: rows.length, progress: `${index + 1}/${dates.length}`, rows_written: rowsWritten }));
  }

  const { data: finalRows } = await supabase
    .from("price_bars")
    .select("date")
    .eq("symbol", "SPY")
    .eq("source", "polygon")
    .order("date", { ascending: false })
    .limit(1);
  console.log(
    JSON.stringify(
      {
        ok: true,
        from,
        to,
        latest_spy_date: finalRows?.[0]?.date ?? null,
        sessions_written: sessionsWritten,
        rows_written: rowsWritten,
        skipped_dates: skippedDates,
        duration_ms: Date.now() - startedAt,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
