"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Job = {
  label: string;
  endpoint: string;
  variant?: "primary" | "secondary";
};

const JOBS: Job[] = [
  { label: "Ingest Polygon (SPY + core_400)", endpoint: "/api/ingest-polygon", variant: "secondary" },
  { label: "Calculate SPY Regime", endpoint: "/api/regime", variant: "secondary" },
  { label: "Run Daily Scan", endpoint: "/api/scan", variant: "primary" },
];

export default function UtilitiesClient() {
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function runJob(job: Job) {
    setMsg(null);
    setRunning(job.endpoint);

    try {
      const res = await fetch(job.endpoint, { method: "POST" });
      const json = await res.json().catch(() => null);

      if (!res.ok || (json && json.ok === false)) {
        const err = json?.error || json?.message || `Request failed (${res.status})`;
        setMsg(`${job.label}: ${err}`);
        return;
      }

      window.location.reload();
    } catch {
      setMsg(`${job.label}: Failed to fetch`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div>
      {msg ? (
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          {msg}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {JOBS.map((job) => (
          <Button
            key={job.endpoint}
            variant={job.variant ?? "secondary"}
            disabled={running === job.endpoint}
            onClick={() => runJob(job)}
          >
            {running === job.endpoint ? "Working..." : job.label}
          </Button>
        ))}
      </div>
    </div>
  );
}