"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BrokerRefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRefresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/broker/read-only-status", {
        method: "GET",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(String(payload?.error ?? "Broker refresh failed"));
      }
      router.refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Broker refresh failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={onRefresh}
        disabled={busy}
        className="rounded-xl border border-[#d8c8aa] bg-[#f1e4cd] px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-[#ecdcbf] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Refreshing..." : "Refresh snapshot"}
      </button>
      {error ? <div className="text-[11px] text-rose-600">{error}</div> : null}
    </div>
  );
}
