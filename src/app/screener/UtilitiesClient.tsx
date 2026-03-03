"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

type Json = any;

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY_VERSION = "v2_core_momentum";

function pretty(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function UtilitiesClient() {
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");

  // ingest controls
  const [ingestBatchSize, setIngestBatchSize] = useState<number>(100);

  // scan batch controls
  const [scanLimit, setScanLimit] = useState<number>(200);
  const [scanOffset, setScanOffset] = useState<number>(0);

  const scanOffsets = useMemo(() => {
    // core_800 default batching
    return [0, 200, 400, 600];
  }, []);

  function append(title: string, payload: any) {
    const block = `\n\n### ${title}\n${pretty(payload)}`;
    setLog((prev) => (prev ? prev + block : block));
  }

  async function callJson(title: string, url: string, init?: RequestInit) {
    try {
      setBusy(title);
      const res = await fetch(url, init);
      const json = await res.json().catch(() => null);
      append(`${title} (${res.status})`, json ?? { ok: false, error: "No JSON response" });
      return { res, json };
    } catch (e: any) {
      append(`${title} (error)`, { ok: false, error: e?.message ?? "Unknown error" });
      return { res: null as any, json: null as any };
    } finally {
      setBusy(null);
    }
  }

  // --- actions ---

  async function buildCore800() {
    // Build a high-liquidity universe tuned for swing momentum
    await callJson(
      "Build Core 800 universe",
      "/api/universe/build-liquid-2000",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          universe_slug: DEFAULT_UNIVERSE,
          min_price: 5,
          max_price: 999999,
          limit: 800,
        }),
      }
    );
  }

  async function ingestCoreUniverse() {
    await callJson(
      `Ingest ${DEFAULT_UNIVERSE} history (batch_size=${ingestBatchSize})`,
      "/api/universe/ingest-liquid-2000",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ universe_slug: DEFAULT_UNIVERSE, batch_size: ingestBatchSize }),
      }
    );
  }

  async function runScanBatch(offset: number, limit: number) {
    await callJson(
      `Scan ${DEFAULT_UNIVERSE} batch (offset=${offset}, limit=${limit})`,
      "/api/scan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          universe_slug: DEFAULT_UNIVERSE,
          strategy_version: DEFAULT_STRATEGY_VERSION,
          offset,
          limit,
        }),
      }
    );
  }

  async function runScanAllBatches() {
    // sequential batches so we don’t blow up Vercel
    setBusy("Scan ALL batches");
    append("Scan ALL batches (start)", { universe_slug: DEFAULT_UNIVERSE, offsets: scanOffsets, limit: scanLimit });

    try {
      for (const off of scanOffsets) {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            universe_slug: DEFAULT_UNIVERSE,
            strategy_version: DEFAULT_STRATEGY_VERSION,
            offset: off,
            limit: scanLimit,
          }),
        });
        const json = await res.json().catch(() => null);
        append(`Scan batch offset=${off} (${res.status})`, json);

        // tiny pause to reduce burst load
        await sleep(300);
      }

      append("Scan ALL batches (done)", { ok: true });
    } catch (e: any) {
      append("Scan ALL batches (error)", { ok: false, error: e?.message ?? "Unknown error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-semibold text-slate-900">Universe: Core 800</div>
        <div className="text-sm text-slate-600">
          These utilities help you (1) build the universe, (2) ingest daily history, then (3) scan in safe batches.
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={buildCore800} disabled={!!busy}>
            {busy === "Build Core 800 universe" ? "Building..." : "Build / Refresh Core 800"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-semibold text-slate-900">Ingest history</div>
        <div className="text-sm text-slate-600">
          Fills <span className="font-mono">price_bars</span> so symbols become scan-ready (≥220 bars).
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500">Batch size</label>
          <input
            className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            value={ingestBatchSize}
            onChange={(e) => setIngestBatchSize(Number(e.target.value) || 100)}
            inputMode="numeric"
            disabled={!!busy}
          />
          <Button onClick={ingestCoreUniverse} disabled={!!busy}>
            {busy?.startsWith(`Ingest ${DEFAULT_UNIVERSE} history`) ? "Ingesting..." : "Ingest next batch"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-semibold text-slate-900">Run scan</div>
        <div className="text-sm text-slate-600">
          Runs the daily scan on <span className="font-mono">{DEFAULT_UNIVERSE}</span>. Use batches to avoid timeouts.
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500">Limit</label>
          <input
            className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            value={scanLimit}
            onChange={(e) => setScanLimit(Number(e.target.value) || 200)}
            inputMode="numeric"
            disabled={!!busy}
          />
          <label className="text-xs text-slate-500">Offset</label>
          <input
            className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            value={scanOffset}
            onChange={(e) => setScanOffset(Number(e.target.value) || 0)}
            inputMode="numeric"
            disabled={!!busy}
          />

          <Button
            variant="secondary"
            onClick={() => runScanBatch(scanOffset, scanLimit)}
            disabled={!!busy}
          >
            Run scan batch
          </Button>

          <Button onClick={runScanAllBatches} disabled={!!busy}>
            {busy === "Scan ALL batches" ? "Scanning..." : "Run scan (all batches)"}
          </Button>
        </div>

        <div className="text-xs text-slate-500">
          Suggested: keep ingesting until 500+ symbols are scan-ready, then run scan (all batches).
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Logs</div>
          <button
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => setLog("")}
            disabled={!!busy}
          >
            Clear
          </button>
        </div>

        <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{log || "No logs yet."}
        </pre>
      </div>
    </div>
  );
}
