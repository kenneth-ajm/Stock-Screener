"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PortfolioOption = {
  id: string;
  name: string | null;
  is_default?: boolean | null;
};

export default function HeaderPortfolioSelector({ portfolios }: { portfolios: PortfolioOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const defaultId = useMemo(
    () => portfolios.find((p) => p.is_default)?.id ?? portfolios[0]?.id ?? "",
    [portfolios]
  );
  const [selected, setSelected] = useState(defaultId);

  async function onChange(next: string) {
    setSelected(next);
    if (!next) return;
    try {
      setBusy(true);
      const res = await fetch("/api/portfolios/set-default", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portfolio_id: next }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? "Failed to switch portfolio");
      router.refresh();
    } catch {
      setSelected(defaultId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      disabled={busy || portfolios.length === 0}
      className="rounded-xl border border-[#e8dcc8] bg-[#fffaf2] px-3 py-1.5 text-xs text-slate-700"
    >
      {portfolios.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name ?? "Main"}
        </option>
      ))}
    </select>
  );
}
