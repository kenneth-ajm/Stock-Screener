"use client";

import { useState } from "react";

function money(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

export default function PaperAccountControlsClient({
  initialCashTotal,
  initialCashAvailable,
  initialCapitalDeployed,
  defaultResetAmount,
}: {
  initialCashTotal: number;
  initialCashAvailable: number;
  initialCapitalDeployed: number;
  defaultResetAmount: number;
}) {
  const [cashTotal, setCashTotal] = useState(initialCashTotal);
  const [cashAvailable, setCashAvailable] = useState(initialCashAvailable);
  const [capitalDeployed, setCapitalDeployed] = useState(initialCapitalDeployed);
  const [amount, setAmount] = useState(String(defaultResetAmount));
  const [resetPositions, setResetPositions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function resetCash() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const n = Number(amount);
      const body = {
        cash_balance: Number.isFinite(n) && n >= 0 ? n : defaultResetAmount,
        reset_positions: resetPositions,
      };
      const res = await fetch("/api/paper-positions/reset-cash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Failed to reset paper cash");
      }
      setCashTotal(Number(payload.cash_total ?? 0));
      setCashAvailable(Number(payload.cash_available ?? 0));
      setCapitalDeployed(Number(payload.capital_deployed ?? 0));
      setMessage(
        payload?.reset_positions
          ? `Paper portfolio reset to ${money(Number(payload.cash_total ?? 0))}.`
          : `Paper cash reset to ${money(Number(payload.cash_total ?? 0))}.`
      );
    } catch (e: any) {
      setError(e?.message ?? "Failed to reset paper cash");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] p-4">
      <div className="mb-3 text-sm font-semibold text-slate-800">Paper Account Controls</div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3">
          <div className="text-xs text-slate-500">Paper cash total</div>
          <div className="mt-1 text-lg font-semibold">{money(cashTotal)}</div>
        </div>
        <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3">
          <div className="text-xs text-slate-500">Paper cash available</div>
          <div className="mt-1 text-lg font-semibold">{money(cashAvailable)}</div>
        </div>
        <div className="rounded-lg border border-[#eadfce] bg-[#fffaf2] p-3">
          <div className="text-xs text-slate-500">Paper capital deployed</div>
          <div className="mt-1 text-lg font-semibold">{money(capitalDeployed)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 rounded-lg border border-[#dcc9a8] bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-[#bca06b] focus:outline-none"
          placeholder="25000"
          inputMode="decimal"
        />
        <button
          type="button"
          onClick={resetCash}
          disabled={busy}
          className="rounded-lg border border-[#d8c8aa] bg-[#f1e4cd] px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-[#ecdcbf] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Resetting..." : "Reset Paper Cash"}
        </button>
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={resetPositions}
            onChange={(e) => setResetPositions(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-[#ccb78f]"
          />
          Reset Paper Portfolio
        </label>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        Cash-only validation stays enabled for paper trades. This controls paper-mode buying capacity only.
      </div>
      {message ? <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">{message}</div> : null}
      {error ? <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">{error}</div> : null}
    </div>
  );
}

