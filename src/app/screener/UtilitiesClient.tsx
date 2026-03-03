"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

const DEFAULT_UNIVERSE = "liquid_2000";
const DEFAULT_VERSION = "v1";

const BUY_CAP = 5;
const WATCH_CAP = 10;

// You can tweak these without touching backend logic
const BATCH_SIZE = 300;
const BATCH_OFFSETS = [0, 300, 600, 900, 1200, 1500, 1800];

type ApiResult = {
  ok: boolean;
  error?: string;
  [k: string]: any;
};

async function postJSON(url: string, body: any): Promise<ApiResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
  return data;
}

export default function UtilitiesClient() {
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [scanDate, setScanDate] = useState<string>(""); // optional override

  const universe_slug = DEFAULT_UNIVERSE;
  const version = DEFAULT_VERSION;

  const header = useMemo(() => {
    return `Universe: ${universe_slug} • Caps: BUY=${BUY_CAP} WATCH=${WATCH_CAP} • BatchSize=${BATCH_SIZE}`;
  }, []);

  function pushLog(line: string) {
    setLog((prev) => [line, ...prev].slice(0, 80));
  }

  async function run(name: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    pushLog(`▶ ${name}`);
    try {
      await fn();
      pushLog(`✅ ${name} done`);
    } catch (e: any) {
      pushLog(`❌ ${name} error: ${e?.message || "Unknown error"}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border bg-white/60 p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">{header}</div>
          <div className="text-xs text-muted-foreground">
            Liquid 2000 is the default everywhere. Global caps are enforced after every scan batch.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={scanDate}
            onChange={(e) => setScanDate(e.target.value)}
            placeholder="scan_date (YYYY-MM-DD) optional"
            className="h-9 w-56 rounded-md border bg-white/70 px-3 text-sm outline-none"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Button
          disabled={!!busy}
          onClick={() =>
            run("Build/Refresh liquid_2000", async () => {
              const r = await postJSON("/api/universe/build-liquid-2000", {});
              if (!r.ok) throw new Error(r.error);
              pushLog(`• build result: ${JSON.stringify(r)}`);
            })
          }
        >
          {busy === "Build/Refresh liquid_2000" ? "Working..." : "Build/Refresh Liquid 2000"}
        </Button>

        <Button
          disabled={!!busy}
          onClick={() =>
            run("Ingest next batch (liquid_2000)", async () => {
              const r = await postJSON("/api/universe/ingest-liquid-2000", {
                universe_slug,
              });
              if (!r.ok) throw new Error(r.error);
              pushLog(`• ingest result: ${JSON.stringify(r)}`);
            })
          }
        >
          {busy === "Ingest next batch (liquid_2000)" ? "Working..." : "Ingest Next Batch"}
        </Button>

        <Button
          disabled={!!busy}
          onClick={() =>
            run("Scan batch (offset 0)", async () => {
              const r = await postJSON("/api/scan", {
                universe_slug,
                version,
                offset: 0,
                limit: BATCH_SIZE,
                ...(scanDate ? { scan_date: scanDate } : {}),
              });
              if (!r.ok) throw new Error(r.error);
              pushLog(`• scan batch 0: ${JSON.stringify(r)}`);
            })
          }
        >
          {busy === "Scan batch (offset 0)" ? "Working..." : "Scan Batch (offset 0)"}
        </Button>

        <Button
          disabled={!!busy}
          onClick={() =>
            run("Scan ALL batches (global caps)", async () => {
              for (const off of BATCH_OFFSETS) {
                pushLog(`• scanning batch offset=${off} limit=${BATCH_SIZE}`);
                const r = await postJSON("/api/scan", {
                  universe_slug,
                  version,
                  offset: off,
                  limit: BATCH_SIZE,
                  ...(scanDate ? { scan_date: scanDate } : {}),
                });
                if (!r.ok) throw new Error(r.error);
                pushLog(`  ↳ result: processed=${r.processed} upserted=${r.upserted}`);
              }
              pushLog("• All batches complete. Caps enforced after each batch automatically.");
            })
          }
        >
          {busy === "Scan ALL batches (global caps)" ? "Working..." : "Scan All Batches"}
        </Button>
      </div>

      <div className="mt-4 rounded-xl border bg-white/50 p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">Activity log</div>
        <div className="max-h-72 overflow-auto text-xs leading-relaxed">
          {log.length === 0 ? (
            <div className="text-muted-foreground">No activity yet.</div>
          ) : (
            <ul className="space-y-1">
              {log.map((l, i) => (
                <li key={i} className="font-mono">
                  {l}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}