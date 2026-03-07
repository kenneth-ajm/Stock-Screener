import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import BrokerRefreshButton from "./BrokerRefreshButton";
import { buildReconciliationAssistant } from "@/lib/broker/reconciliation_assistant";

export const dynamic = "force-dynamic";

type BrokerAccount = {
  currency?: string | null;
  cash_available?: number | null;
  equity?: number | null;
  buying_power?: number | null;
  as_of?: string | null;
};

type BrokerPosition = {
  symbol: string;
  quantity: number;
  average_cost?: number | null;
  market_price?: number | null;
  market_value?: number | null;
  unrealized_pnl?: number | null;
  as_of?: string | null;
};

type BrokerReconciliation = {
  broker_only?: string[];
  internal_only?: string[];
  broker_open_symbols?: number;
  portfolio_open_symbols?: number;
  quantity_mismatches?: Array<Record<string, unknown>>;
  avg_cost_mismatches?: Array<Record<string, unknown>>;
  warnings?: string[];
};

type BrokerSnapshotValue = {
  run_at?: string;
  provider?: string;
  mode?: string;
  configured?: boolean;
  auth_ok?: boolean;
  connection_ok?: boolean;
  account?: BrokerAccount | null;
  positions_count?: number;
  positions?: BrokerPosition[];
  latest_broker_as_of?: string | null;
  warnings?: string[];
  errors?: string[];
  reconciliation?: BrokerReconciliation | null;
};

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtNum(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default async function BrokerPage() {
  const { supabase, user, portfolios, defaultPortfolio } = await getWorkspaceContext("/broker");
  const key = `broker_snapshot_last_run:${user.id}`;

  const { data: statusRow } = await supabase
    .from("system_status")
    .select("updated_at,value")
    .eq("key", key)
    .maybeSingle();

  const snapshot = (statusRow?.value ?? null) as BrokerSnapshotValue | null;
  const account = snapshot?.account ?? null;
  const positions = Array.isArray(snapshot?.positions) ? snapshot!.positions! : [];
  const reconciliation = snapshot?.reconciliation ?? null;
  const portfolioId = String(defaultPortfolio?.id ?? "");
  const { data: internalOpenRows } = portfolioId
    ? await supabase
        .from("portfolio_positions")
        .select("symbol,shares,quantity,position_size,entry_price")
        .eq("portfolio_id", portfolioId)
        .eq("status", "OPEN")
    : ({ data: [] } as { data: unknown[] });

  const assistant = buildReconciliationAssistant({
    broker_positions: positions,
    internal_positions: (internalOpenRows ?? []) as Array<{
      symbol?: string | null;
      shares?: number | null;
      quantity?: number | null;
      position_size?: number | null;
      entry_price?: number | null;
    }>,
  });

  const brokerOnly = Array.isArray(reconciliation?.broker_only) ? reconciliation!.broker_only! : [];
  const internalOnly = Array.isArray(reconciliation?.internal_only) ? reconciliation!.internal_only! : [];
  const matchedCount =
    Math.max(
      0,
      Number(reconciliation?.broker_open_symbols ?? positions.length) - brokerOnly.length
    ) || 0;

  return (
    <AppShell currentPath="/broker" userEmail={user.email ?? ""} portfolios={portfolios}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Broker</h1>
            <p className="mt-1 text-sm text-slate-600">Tiger read-only visibility and reconciliation.</p>
          </div>
          <BrokerRefreshButton />
        </div>

        {!snapshot ? (
          <div className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4 text-sm text-slate-600">
            No broker snapshot persisted yet. Click <span className="font-semibold">Refresh snapshot</span> to run read-only sync.
          </div>
        ) : null}

        {snapshot ? (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-4">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Connection</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {snapshot.connection_ok ? "Connected" : snapshot.configured ? "Configured / Not Connected" : "Not Configured"}
                </div>
                <div className="mt-1 text-xs text-slate-500">Provider: {snapshot.provider ?? "tiger"}</div>
              </div>
              <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-4">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Last Sync</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{statusRow?.updated_at ?? snapshot.run_at ?? "—"}</div>
                <div className="mt-1 text-xs text-slate-500">As of: {snapshot.latest_broker_as_of ?? account?.as_of ?? "—"}</div>
              </div>
              <div className="rounded-2xl border border-[#dfceb0] bg-[#fff7eb] p-4">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Positions</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{snapshot.positions_count ?? positions.length}</div>
                <div className="mt-1 text-xs text-slate-500">Mode: {snapshot.mode ?? "read_only_live"}</div>
              </div>
            </section>

            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Currency</div>
                <div className="mt-1 font-semibold text-slate-900">{account?.currency ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Cash Available</div>
                <div className="mt-1 font-semibold text-slate-900">{money(account?.cash_available)}</div>
              </div>
              <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Equity / Net Liq</div>
                <div className="mt-1 font-semibold text-slate-900">{money(account?.equity)}</div>
              </div>
              <div className="rounded-xl border border-[#e6d8c1] bg-[#fffdf8] p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Buying Power</div>
                <div className="mt-1 font-semibold text-slate-900">{money(account?.buying_power)}</div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
              <div className="mb-3 text-base font-semibold text-slate-900">Broker Positions</div>
              <div className="overflow-x-auto">
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr className="border-b border-[#e8dcc8]">
                      <th className="p-2">Symbol</th>
                      <th className="p-2">Quantity</th>
                      <th className="p-2">Avg Cost</th>
                      <th className="p-2">Market Price</th>
                      <th className="p-2">Market Value</th>
                      <th className="p-2">Unrealized P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.length === 0 ? (
                      <tr>
                        <td className="p-2 text-slate-500" colSpan={6}>No broker positions in snapshot.</td>
                      </tr>
                    ) : (
                      positions.map((row) => (
                        <tr key={row.symbol} className="border-b border-[#f1e8dc]">
                          <td className="p-2 font-semibold text-slate-900">{row.symbol}</td>
                          <td className="p-2 text-slate-700">{fmtNum(row.quantity)}</td>
                          <td className="p-2 text-slate-700">{money(row.average_cost)}</td>
                          <td className="p-2 text-slate-700">{money(row.market_price)}</td>
                          <td className="p-2 text-slate-700">{money(row.market_value)}</td>
                          <td className={`p-2 font-medium ${Number(row.unrealized_pnl ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {money(row.unrealized_pnl)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
              <div className="mb-3 text-base font-semibold text-slate-900">Reconciliation</div>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Matched Symbols</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{matchedCount}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Broker-only</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{brokerOnly.length}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Internal-only</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{internalOnly.length}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Quantity Mismatches</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{Array.isArray(reconciliation?.quantity_mismatches) ? reconciliation?.quantity_mismatches?.length : 0}</div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2 text-sm">
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Broker-only symbols</div>
                  <div className="text-slate-700">{brokerOnly.length ? brokerOnly.join(", ") : "—"}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Internal-only symbols</div>
                  <div className="text-slate-700">{internalOnly.length ? internalOnly.join(", ") : "—"}</div>
                </div>
              </div>

              {(snapshot.warnings?.length || snapshot.errors?.length || reconciliation?.warnings?.length) ? (
                <div className="mt-3 space-y-1 text-xs">
                  {(snapshot.warnings ?? []).map((w, i) => (
                    <div key={`w-${i}`} className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">{w}</div>
                  ))}
                  {(snapshot.errors ?? []).map((e, i) => (
                    <div key={`e-${i}`} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">{e}</div>
                  ))}
                  {(reconciliation?.warnings ?? []).map((w, i) => (
                    <div key={`rw-${i}`} className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">{w}</div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-[#e8dcc8] bg-[#fffaf2] p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-base font-semibold text-slate-900">Position Import Assistant (Read-only)</div>
                <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  No auto-import
                </span>
              </div>
              <p className="text-xs text-slate-600">
                These are proposal-only mappings for broker-held symbols missing internally. Nothing is written automatically.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Broker-only candidates</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{assistant.broker_only_count}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Matched symbols</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{assistant.matched_count}</div>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Internal-only symbols</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{assistant.internal_only_count}</div>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr className="border-b border-[#e8dcc8]">
                      <th className="p-2">Symbol</th>
                      <th className="p-2">Broker Qty</th>
                      <th className="p-2">Broker Avg Cost</th>
                      <th className="p-2">Suggested Entry</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Required Manual Fields</th>
                      <th className="p-2">Proposal Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assistant.proposals.length === 0 ? (
                      <tr>
                        <td className="p-2 text-slate-500" colSpan={7}>
                          No broker-only positions to map.
                        </td>
                      </tr>
                    ) : (
                      assistant.proposals.map((p) => (
                        <tr key={p.symbol} className="border-b border-[#f1e8dc] align-top">
                          <td className="p-2 font-semibold text-slate-900">{p.symbol}</td>
                          <td className="p-2 text-slate-700">{fmtNum(p.broker_quantity)}</td>
                          <td className="p-2 text-slate-700">{money(p.broker_average_cost)}</td>
                          <td className="p-2 text-slate-700">{money(p.suggested_entry_price)}</td>
                          <td className="p-2">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                p.status === "ready_for_manual_import"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {p.status === "ready_for_manual_import" ? "Ready for manual import" : "Needs manual entry"}
                            </span>
                          </td>
                          <td className="p-2 text-slate-600">{p.required_manual_fields.join(", ")}</td>
                          <td className="p-2">
                            <details className="rounded-lg border border-[#eadfce] bg-[#fffdf8] p-2">
                              <summary className="cursor-pointer text-xs font-medium text-slate-700">View payload</summary>
                              <pre className="mt-2 whitespace-pre-wrap text-[11px] text-slate-700">
                                {JSON.stringify(p.suggested_payload, null, 2)}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
