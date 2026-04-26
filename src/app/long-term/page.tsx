import AppShell from "@/components/app-shell";
import { QUALITY_DIP_WATCHLIST } from "@/lib/quality_dip_watchlist";
import { getWorkspaceContext } from "@/lib/workspace_context";

export const dynamic = "force-dynamic";

type LongTermRow = {
  symbol: string;
  name: string;
  group: string;
  close: number | null;
  sourceDate: string | null;
  sma200: number | null;
  high260: number | null;
  drawdownPct: number | null;
  state: "Starter" | "Add On" | "Watch" | "Repair";
  note: string;
};

function toNum(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(2)}`;
}

function fmtPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stateClass(state: LongTermRow["state"]) {
  if (state === "Starter") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "Add On") return "border-sky-200 bg-sky-50 text-sky-800";
  if (state === "Watch") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

const longTermLegend = [
  {
    term: "Starter",
    meaning: "A first small long-term buy candidate. The stock is still above its 200-day trend and has pulled back enough to consider starting slowly.",
  },
  {
    term: "Add On",
    meaning: "A stock that still looks healthy, but is not offering much of a dip. Better for adding gradually if you already want long-term exposure.",
  },
  {
    term: "Watch",
    meaning: "Worth keeping on the radar, but not clean enough for a new long-term buy today.",
  },
  {
    term: "Repair",
    meaning: "The long-term setup needs time to heal, usually because price is below the 200-day average. This is a patience bucket, not a buy-now bucket.",
  },
  {
    term: "From 1Y high",
    meaning: "How far the latest close is below the highest price from roughly the past year. A 15% reading means the stock is about 15% below that high.",
  },
  {
    term: "SMA200",
    meaning: "The 200-day simple moving average. It is used here as a basic long-term trend line.",
  },
];

export default async function LongTermPage() {
  const { supabase, user, portfolios } = await getWorkspaceContext("/long-term");

  const barsBySymbol = new Map<string, Array<{ date: string; close: number; high: number }>>();
  await Promise.all(
    QUALITY_DIP_WATCHLIST.map(async (item) => {
      const { data: bars } = await supabase
        .from("price_bars")
        .select("date,close,high")
        .eq("symbol", item.symbol)
        .order("date", { ascending: false })
        .limit(260);

      const list = (bars ?? [])
        .map((bar: any) => {
          const date = String(bar?.date ?? "");
          const close = toNum(bar?.close);
          const high = toNum(bar?.high);
          if (!date || close == null || high == null) return null;
          return { date, close, high };
        })
        .filter((bar): bar is { date: string; close: number; high: number } => Boolean(bar));
      barsBySymbol.set(item.symbol.toUpperCase(), list);
    })
  );

  const rows: LongTermRow[] = QUALITY_DIP_WATCHLIST.map((item) => {
    const symbol = item.symbol.toUpperCase();
    const list = barsBySymbol.get(symbol) ?? [];
    const latest = list[0] ?? null;
    const close = latest?.close ?? null;
    const sma200 = average(list.slice(0, 200).map((bar) => bar.close));
    const high260 = list.length ? Math.max(...list.map((bar) => bar.high)) : null;
    const drawdownPct =
      close != null && high260 != null && high260 > 0 ? ((high260 - close) / high260) * 100 : null;
    const aboveSma200 = close != null && sma200 != null ? close >= sma200 : null;
    let state: LongTermRow["state"] = "Watch";
    let note = "Needs a cleaner long-term price setup.";

    if (aboveSma200 === false) {
      state = "Repair";
      note = "Below SMA200; thesis needs patience.";
    } else if (drawdownPct != null && drawdownPct >= 8 && drawdownPct <= 22) {
      state = "Starter";
      note = "Healthy trend with a meaningful pullback.";
    } else if (drawdownPct != null && drawdownPct > 22) {
      state = "Watch";
      note = "Deep drawdown; review business quality before adding.";
    } else if (aboveSma200 === true) {
      state = "Add On";
      note = "Trend intact; better as staged accumulation.";
    }

    return {
      symbol,
      name: item.name,
      group: item.group,
      close,
      sourceDate: latest?.date ?? null,
      sma200,
      high260,
      drawdownPct,
      state,
      note,
    };
  }).sort((a, b) => {
    const stateOrder = { Starter: 0, "Add On": 1, Watch: 2, Repair: 3 };
    const stateDelta = stateOrder[a.state] - stateOrder[b.state];
    if (stateDelta !== 0) return stateDelta;
    return String(a.group).localeCompare(String(b.group)) || a.symbol.localeCompare(b.symbol);
  });

  const grouped = rows.reduce(
    (acc, row) => {
      const list = acc.get(row.group) ?? [];
      list.push(row);
      acc.set(row.group, list);
      return acc;
    },
    new Map<string, LongTermRow[]>()
  );

  return (
    <AppShell currentPath="/long-term" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-2">
        <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          5-10 year portfolio list
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-[2.1rem]">Long-Term</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Quality names and ETF anchors separated from the trading workflow.
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        {(["Starter", "Add On", "Watch", "Repair"] as const).map((state) => (
          <div key={state} className="surface-panel p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{state}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {rows.filter((row) => row.state === state).length}
            </div>
          </div>
        ))}
      </div>

      <section className="surface-panel mt-5 p-4">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Legend</div>
          <h2 className="section-title">How to read the long-term list</h2>
          <p className="max-w-3xl text-sm leading-6 text-slate-600">
            This page is for slow portfolio candidates, not same-day trades. The labels are meant to help decide whether a name is ready for a small starter buy, better suited for gradual accumulation, or needs more time.
          </p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {longTermLegend.map((item) => (
            <div key={item.term} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
              <div className="text-sm font-semibold text-slate-900">{item.term}</div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{item.meaning}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-5 space-y-5">
        {Array.from(grouped.entries()).map(([group, groupRows]) => (
          <section key={group} className="surface-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="section-title">{group}</h2>
              <span className="surface-chip px-2.5 py-1 text-xs font-medium text-slate-600">
                {groupRows.length} names
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2 text-right">Close</th>
                    <th className="px-3 py-2 text-right">SMA200</th>
                    <th className="px-3 py-2 text-right">From 1Y high</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((row) => (
                    <tr key={row.symbol} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-3 font-mono font-semibold text-slate-900">{row.symbol}</td>
                      <td className="px-3 py-3 text-slate-700">{row.name}</td>
                      <td className="px-3 py-3 text-right font-mono">{fmtMoney(row.close)}</td>
                      <td className="px-3 py-3 text-right font-mono">{fmtMoney(row.sma200)}</td>
                      <td className="px-3 py-3 text-right font-mono">{fmtPct(row.drawdownPct)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${stateClass(row.state)}`}>
                          {row.state}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
