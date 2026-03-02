"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Portfolio = {
  id: string;
  name: string | null;
  account_currency: string | null;
  account_size: number | null;
  risk_per_trade: number | null; // decimal e.g. 0.02
  max_positions: number | null;
  is_default: boolean | null;
};

function pct(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function Toast({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl">
        {msg}
      </div>
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
  const [riskPct, setRiskPct] = useState("2.0"); // percent UI
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
    const res = await fetch("/api/portfolios/list");
    const json = await res.json();
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
      const json = await res.json();
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
      const json = await res.json();
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

  async function setDefault(portfolioId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/portfolios/set-default", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Set default failed");
      await refresh();
      showToast("Default updated ✅");
    } catch (e: any) {
      showToast(e?.message ?? "Set default failed");
    } finally {
      setBusy(false);
    }
  }

  async function openPortfolio(p: Portfolio) {
    // Make click feel instant even if network is slow
    try {
      if (!p.is_default) {
        await setDefault(p.id);
      }
    } finally {
      router.push("/portfolio");
    }
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
      const json = await res.json();
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

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          Default portfolio is used for sizing and opening positions from the Screener.
          <span className="ml-2 text-slate-500">Tip: click a portfolio row to open it.</span>
        </div>
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
              <th className="p-3">Capital</th>
              <th className="p-3">Risk/Trade</th>
              <th className="p-3">Max positions</th>
              <th className="p-3">Default</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {portfolios.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={6}>
                  No portfolios yet.
                </td>
              </tr>
            ) : (
              portfolios.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => {
                    if (busy) return;
                    openPortfolio(p);
                  }}
                  title="Open portfolio"
                >
                  <td className="p-3 font-semibold text-slate-900">{p.name ?? "—"}</td>
                  <td className="p-3 text-slate-800">
                    {p.account_currency ?? "USD"} {money(p.account_size)}
                  </td>
                  <td className="p-3 text-slate-800">{pct(p.risk_per_trade)}</td>
                  <td className="p-3 text-slate-800">{p.max_positions ?? "—"}</td>
                  <td className="p-3">
                    {p.is_default ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                        Default
                      </span>
                    ) : (
                      <button
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDefault(p.id);
                        }}
                        disabled={busy}
                      >
                        Set default
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
                        title="Open portfolio dashboard"
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
                        title={p.id === defaultId ? "Set another default before deleting" : "Delete"}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
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
              <label className="text-xs text-slate-500">Capital (account size)</label>
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