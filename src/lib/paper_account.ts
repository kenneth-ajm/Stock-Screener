import { createClient } from "@supabase/supabase-js";

const PAPER_CASH_KEY_PREFIX = "paper_trading_cash_";
const OPEN_STATUSES = ["PENDING", "OPEN"];

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getDefaultPaperCash() {
  const env = Number(process.env.PAPER_DEFAULT_CASH ?? "");
  if (Number.isFinite(env) && env > 0) return env;
  return 25_000;
}

export function makePaperAccountClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } }) as any;
}

function paperCashKey(userId: string) {
  return `${PAPER_CASH_KEY_PREFIX}${userId}`;
}

export async function getPaperCashTotal(opts: { supabase?: any; user_id: string }) {
  const supa = (opts.supabase ?? makePaperAccountClient()) as any;
  const key = paperCashKey(opts.user_id);
  const { data, error } = await supa
    .from("system_status")
    .select("value,updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  const stored = toNum(data?.value?.cash_balance);
  if (stored != null && stored >= 0) {
    return {
      cash_total: stored,
      source: "stored" as const,
      updated_at: String(data?.updated_at ?? "") || null,
    };
  }
  const fallback = getDefaultPaperCash();
  return {
    cash_total: fallback,
    source: "default" as const,
    updated_at: null,
  };
}

export async function setPaperCashTotal(opts: {
  supabase?: any;
  user_id: string;
  cash_total: number;
  note?: string | null;
}) {
  const supa = (opts.supabase ?? makePaperAccountClient()) as any;
  const key = paperCashKey(opts.user_id);
  const now = new Date().toISOString();
  const payload = {
    key,
    value: {
      user_id: opts.user_id,
      cash_balance: Number(opts.cash_total),
      note: opts.note ?? null,
      updated_at: now,
    },
    updated_at: now,
  };
  const { error } = await supa.from("system_status").upsert(payload, { onConflict: "key" });
  if (error) throw error;
  return { cash_total: Number(opts.cash_total), updated_at: now };
}

export async function getPaperTradingCapacity(opts: { supabase?: any; user_id: string }) {
  const supa = (opts.supabase ?? makePaperAccountClient()) as any;
  const wallet = await getPaperCashTotal({ supabase: supa, user_id: opts.user_id });
  const { data: openRows, error } = await supa
    .from("paper_positions")
    .select("entry_price,shares,status")
    .eq("user_id", opts.user_id)
    .in("status", OPEN_STATUSES);
  if (error) throw error;
  const deployed = (openRows ?? []).reduce((sum: number, row: any) => {
    const entry = toNum(row?.entry_price);
    const shares = toNum(row?.shares);
    if (entry == null || shares == null || entry <= 0 || shares <= 0) return sum;
    return sum + entry * shares;
  }, 0);
  const cashAvailable = Math.max(0, wallet.cash_total - deployed);
  return {
    cash_total: wallet.cash_total,
    cash_available: cashAvailable,
    capital_deployed: deployed,
    source: wallet.source,
    updated_at: wallet.updated_at,
  };
}

export async function resetPaperPortfolio(opts: { supabase?: any; user_id: string }) {
  const supa = (opts.supabase ?? makePaperAccountClient()) as any;
  const { error } = await supa.from("paper_positions").delete().eq("user_id", opts.user_id);
  if (error) throw error;
  return { ok: true };
}

