"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PortfolioStats = {
  deployed: number;
  openCount: number;
  realized: number;
};

type Portfolio = {
  id: string;
  name: string | null;
  account_currency: string | null;
  account_size: number | null;
  risk_per_trade: number | null;
  max_positions: number | null;
  is_default: boolean | null;
  stats?: PortfolioStats;
};

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function moneySigned(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

function Toast({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">{msg}</div>
    </div>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="text-base font-semibold text-slate-900">{title}</div>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function PortfoliosClient({ initialPortfolios }: { initialPortfolios: Portfolio[] }) {
  const router = useRouter();

  const [portfolios, setPortfolios] = useState<Portfolio[]>(initialPortfolios);
  const [toast, setToast] = useState<string | null>(null);

  const defaultId = useMemo(() => portfolios.find((p) => p.is_default)?.id ?? null, [portfolios]);

  const [modalOpen, setModalOpen] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<Portfolio | null>(null);

  // form state
  const [name, setName] = useState("Main");
  const [currency, setCurrency] = useState("USD");
  const [accountSize, setAccountSize] = useState("11000");
  const [riskPct, setRiskPct] = useState("2.0");
  const [maxPositions, setMaxPositions] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  function openCreate() {
    setEditing(null);
    setName("Main");
    setCurrency("USD");
    setAccountSize("11000");
    setRiskPct("2.0");
    setMaxPositions("5");
    setError(null);
    setModalOpen("create");
  }

  function openEdit(p: Portfolio) {
    setEditing(p);
    setName(p.name ?? "Main");
    setCurrency(p.account_currency ?? "USD");
    setAccountSize(String(p.account_size ?? 0));
    setRiskPct(String(((p.risk_per_trade ?? 0.02) * 100).toFixed(1)));
    setMaxPositions(String(p.max_positions ?? 5));
    setError(null);
    setModalOpen("edit");
  }

  function closeModal() {
    if (busy) return;
    setModalOpen(null);
    setEditing(null);
    setError(null);
  }

  async function refresh() {
    // If your project doesn’t actually have this endpoint, tell me and we’ll remove refresh() entirely.
    const res = await fetch("/api/portfolios/list");
    const json = await res.json().catch(() => null);
    if (json?.ok) setPortfolios(json.portfolios ?? []);
  }

  async function createPortfolio() {
    setBusy(true);
    setError(null);
    try {
      const size = Number(accountSize);
      const riskDec = Number(riskPct) / 100;
      const maxP = Number(maxPositions);

      const res = await fetch("/api/portfolios/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          account_currency: currency,
          account_size: size,
          risk_per_trade: riskDec,
          max_positions: maxP,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Create failed");

      await refresh();
      showToast("Portfolio created ✅");
      closeModal();
    } catch (e: any) {
      setError(e?.message ?? "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function updatePortfolio() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const size = Number(accountSize);
      const riskDec = Number(riskPct) / 100;
      const maxP = Number(maxPositions);

      const res = await fetch("/api/portfolios/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          portfolio_id: editing.id,
          name,
          account_currency: currency,
          account_size: size,
          risk_per_trade: riskDec,
          max_positions: maxP,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Update failed");

      await refresh();
      showToast("Portfolio updated ✅");
      closeModal();
    } catch (e: any) {
      setError(e?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(portfolioId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/portfolios/set-default", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Set active failed");

      await refresh();
      showToast("Active portfolio updated ✅");
    } catch (e: any) {
      showToast(e?.message ?? "Set active failed");
    } finally {
      setBusy(false);
    }
  }

  async function openPortfolio(p: Portfolio) {
    if (busy) return;
    if (!p.is_default) {
      await setActive(p.id);
    }
    router.push("/portfolio");
  }

  async function deletePortfolio(portfolioId: string) {
    const ok = window.confirm("Delete this portfolio? This cannot be undone.");
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch("/api/portfolios/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Delete failed");
      await refresh();
      showToast("Portfolio deleted ✅");
    } catch (e: any) {
      showToast(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {toast ? <Toast msg={toast} /> : null}

      <div className="flex items-center justify-end">
        <button
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          onClick={openCreate}
          disabled={busy}
        >
          + New Portfolio
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="p-3">Name</th>
              <th className="p-3">Balance</th>
              <th className="p-3">Deployed</th>
              <th className="p-3">Open</th>
              <th className="p-3">Realized P/L</th>
              <th className="p-3">Active</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {portfolios.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>
                  No portfolios yet.
                </td>
              </tr>
            ) : (
              portfolios.map((p) => {
                const deployed = p.stats?.deployed ?? 0;
                const openCount = p.stats?.openCount ?? 0;
                const realized = p.stats?.realized ?? 0;
                const plClass =
                  realized > 0 ? "text-emerald-600" : realized < 0 ? "text-rose-600" : "text-slate-600";

                return (
                  <tr
                    key={p.id}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => openPortfolio(p)}
                  >
                    <td className="p-3 font-semibold text-slate-900">{p.name ?? "—"}</td>

                    <td className="p-3 text-slate-800">
                      {p.account_currency ?? "USD"} {money(p.account_size)}
                    </td>

                    <td className="p-3 text-slate-800">
                      {p.account_currency ?? "USD"} {money(deployed)}
                    </td>

                    <td className="p-3 text-slate-800">{openCount}</td>

                    <td className={`p-3 font-medium ${plClass}`}>
                      {p.account_currency ?? "USD"} {moneySigned(realized)}
                    </td>

                    <td className="p-3">
                      {p.is_default ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                          Active
                        </span>
                      ) : (
                        <button
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setActive(p.id);
                          }}
                          disabled={busy}
                        >
                          Set Active
                        </button>
                      )}
                    </td>

                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openPortfolio(p);
                          }}
                          disabled={busy}
                        >
                          Open
                        </button>

                        <button
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openEdit(p);
                          }}
                          disabled={busy}
                        >
                          Edit
                        </button>

                        <button
                          className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            deletePortfolio(p.id);
                          }}
                          disabled={busy || p.id === defaultId}
                          title={p.id === defaultId ? "Set another Active portfolio before deleting" : "Delete"}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen !== null}
        title={modalOpen === "create" ? "Create portfolio" : "Edit portfolio"}
        onClose={closeModal}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Name</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-500">Currency</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-500">Balance (account size)</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={accountSize}
                onChange={(e) => setAccountSize(e.target.value)}
                inputMode="decimal"
                disabled={busy}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-500">Risk per trade (%)</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={riskPct}
                onChange={(e) => setRiskPct(e.target.value)}
                inputMode="decimal"
                disabled={busy}
              />
              <div className="text-xs text-slate-500">Recommended: 1–2%</div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-500">Max open positions</label>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={maxPositions}
                onChange={(e) => setMaxPositions(e.target.value)}
                inputMode="numeric"
                disabled={busy}
              />
            </div>
          </div>

          {error ? <div className="text-sm text-rose-600">{error}</div> : null}

          <div className="flex justify-end gap-2">
            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              onClick={closeModal}
              disabled={busy}
            >
              Cancel
            </button>

            <button
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              onClick={modalOpen === "create" ? createPortfolio : updatePortfolio}
              disabled={busy}
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}