"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export default function RepairDefaultPortfolioButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runRepair() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/repair-default-portfolio", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Repair failed");
      }
      router.refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Repair failed";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={runRepair} disabled={busy}>
        {busy ? "Repairing..." : "Repair default portfolio"}
      </Button>
      {error ? <div className="text-xs text-rose-600">{error}</div> : null}
    </div>
  );
}

