"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export default function CashBalanceEditor({
  initialCashBalance,
}: {
  initialCashBalance: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(
    typeof initialCashBalance === "number" && Number.isFinite(initialCashBalance)
      ? String(initialCashBalance)
      : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload =
        value.trim() === "" ? { cash_balance: null } : { cash_balance: Number(value.trim()) };
      const res = await fetch("/api/portfolio/update-cash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to update cash");
      router.refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to update cash";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-700">Cash balance</div>
      <div className="flex items-center gap-2">
        <input
          className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder="e.g. 5000"
          disabled={busy}
        />
        <Button variant="secondary" onClick={save} disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </Button>
      </div>
      {error ? <div className="text-xs text-rose-600">{error}</div> : null}
      <div className="text-[11px] text-slate-500">
        Leave empty to clear manual cash and use estimated cash.
      </div>
    </div>
  );
}

