"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

type JsonValue = unknown;

const DEFAULT_UNIVERSE = "core_800";
const DEFAULT_STRATEGY_VERSION = "v2_core_momentum";

function pretty(obj: JsonValue) {
  try {
    return JSON.stringify(obj ?? null, null, 2);
  } catch {
    return String(obj);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function UtilitiesClient({
  universeSlug = DEFAULT_UNIVERSE,
  strategyVersion = DEFAULT_STRATEGY_VERSION,
  strategyLabel = "Momentum Swing",
  autopilotStatus = null,
}: {
  universeSlug?: string;
  strategyVersion?: string;
  strategyLabel?: string;
  autopilotStatus?: {
    updated_at?: string | null;
    value?: {
      ok?: boolean;
      date_used?: string | null;
      error?: string | null;
    } | null;
  } | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");
  const [backfillDone, setBackfillDone] = useState(false);
  const [autopilotStatusLive, setAutopilotStatusLive] = useState(autopilotStatus);

  // ingest controls
  const [ingestBatchSize, setIngestBatchSize] = useState<number>(20);
  const [ingestOffset, setIngestOffset] = useState<number>(0);
  const [backfillOffset, setBackfillOffset] = useState<number>(0);

  // scan batch controls
  const [scanLimit, setScanLimit] = useState<number>(200);
  const [scanOffset, setScanOffset] = useState<number>(0);

  const scanOffsets = useMemo(() => {
    // core_800 default batching
    return [0, 200, 400, 600];
  }, []);

  function append(title: string, payload: JsonValue) {
    const block = `\n\n### ${title}\n${pretty(payload)}`;
    setLog((prev) => (prev ? prev + block : block));
  }

  async function callJson(
    title: string,
    url: string,
    init?: RequestInit,
    timeoutMs: number | null = 60000
  ) {
    append(`${title} (start)`, {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? (() => {
        try {
          return JSON.parse(String(init.body));
        } catch {
          return String(init.body);
        }
      })() : null,
    });

    const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : null;
    const timeoutId =
      controller && timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      setBusy(title);
      const res = await fetch(url, controller ? { ...init, signal: controller.signal } : init);
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        append(`${title} (${res.status})`, {
          ok: false,
          status: res.status,
          error: json?.error ?? `Request failed with status ${res.status}`,
          payload: json,
        });
        return { res, json };
      }
      append(`${title} (${res.status})`, json ?? { ok: true, message: "No JSON payload" });
      return { res, json };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      const stack = e instanceof Error ? e.stack ?? null : null;
      append(`${title} (error)`, { ok: false, error: message, detail: stack });
      return { res: null, json: null };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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
    const { res, json } = await callJson(
      `Ingest ${universeSlug} history (batch_size=${ingestBatchSize})`,
      "/api/universe/ingest-liquid-2000",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          universe_slug: universeSlug,
          limit: ingestBatchSize,
          offset: ingestOffset,
        }),
      }
    );
    if (res?.ok && json?.ok) {
      setIngestOffset((prev) => prev + ingestBatchSize);
    }
  }

  async function runBackfillAuto() {
    const { res, json } = await callJson(
      `Backfill ${universeSlug} auto (offset=${backfillOffset}, batch=25)`,
      "/api/jobs/backfill-core-800",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batch_size: 25,
          offset: backfillOffset,
        }),
      }
    );

    if (res?.ok && json?.ok && typeof json.next_offset === "number") {
      setBackfillOffset(json.next_offset);
      setBackfillDone(Boolean(json.done));
    }
  }

  async function runScanBatch(offset: number, limit: number) {
    await callJson(
      `Scan ${universeSlug} batch (offset=${offset}, limit=${limit})`,
      "/api/scan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          universe_slug: universeSlug,
          strategy_version: strategyVersion,
          offset,
          limit,
        }),
      }
    );
  }

  async function runRescanNow() {
    await callJson(
      `Rescan latest completed day (${universeSlug}, ${strategyVersion})`,
      "/api/jobs/rescan-latest",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          universe_slug: universeSlug,
          strategy_version: strategyVersion,
        }),
      },
      null
    );
  }

  async function runRepairLatestScanState() {
    const { res, json } = await callJson(
      "Repair latest scan state",
      "/api/jobs/repair-latest-scan-state",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      120000
    );

    if (res?.ok && json?.ok) {
      await callJson("Diagnostics after repair", "/api/diagnostics", undefined, 60000);
    }
  }

  async function runFinalizeLatestSignals() {
    const { res, json } = await callJson(
      "Finalize latest signals",
      "/api/jobs/finalize-latest",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      120000
    );

    if (res?.ok && json?.ok) {
      await callJson("Diagnostics after finalization", "/api/diagnostics", undefined, 60000);
    }
  }

  async function runAutopilotNow() {
    const title = "Run daily autopilot now";
    const beforeUpdatedAt = autopilotStatusLive?.updated_at ?? autopilotStatus?.updated_at ?? null;
    append("Autopilot started", { ok: true, baseline_updated_at: beforeUpdatedAt });

    setBusy(title);
    try {
      // Intentionally no AbortController for autopilot kick-off.
      fetch("/api/jobs/daily-autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          append(`${title} trigger (${res.status})`, json ?? { ok: res.ok });
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
          const stack = e instanceof Error ? e.stack ?? null : null;
          append(`${title} trigger (error)`, { ok: false, error: message, detail: stack });
        });

      let completed = false;
      for (let i = 0; i < 30; i++) {
        await sleep(2000);
        const res = await fetch("/api/system-status?key=daily_autopilot_core_800", {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              status?: {
                updated_at?: string | null;
                value?: { ok?: boolean; date_used?: string | null; error?: string | null } | null;
              } | null;
            }
          | null;
        if (!res.ok || !json?.ok || !json?.status) continue;
        setAutopilotStatusLive(json.status);

        const updatedAt = json.status.updated_at ?? null;
        const okFlag = json.status.value?.ok;
        if ((updatedAt && updatedAt !== beforeUpdatedAt) || okFlag === true) {
          append("Autopilot complete", {
            ok: true,
            updated_at: updatedAt,
            date_used: json.status.value?.date_used ?? null,
            status_ok: okFlag ?? null,
            error: json.status.value?.error ?? null,
          });
          completed = true;
          break;
        }
      }

      if (!completed) {
        append("Autopilot polling timeout", {
          ok: false,
          error: "No status update detected within 60 seconds.",
        });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      const stack = e instanceof Error ? e.stack ?? null : null;
      append(`${title} (error)`, { ok: false, error: message, detail: stack });
    } finally {
      setBusy(null);
    }
  }

  async function runScanAllBatches() {
    // sequential batches so we don’t blow up Vercel
    setBusy("Scan ALL batches");
    append("Scan ALL batches (start)", {
      universe_slug: universeSlug,
      strategy_version: strategyVersion,
      offsets: scanOffsets,
      limit: scanLimit,
    });

    try {
      let batchesOk = 0;
      let batchesFailed = 0;
      let firstError: string | null = null;
      let firstErrorDetail: string | null = null;

      for (const off of scanOffsets) {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            universe_slug: universeSlug,
            strategy_version: strategyVersion,
            offset: off,
            limit: scanLimit,
          }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          detail?: string;
          [key: string]: unknown;
        } | null;
        append(`Scan batch offset=${off} (${res.status})`, {
          status: res.status,
          ok: res.ok && !!json?.ok,
          payload: json,
        });
        const batchOk = res.ok && !!json?.ok;
        if (batchOk) batchesOk += 1;
        else {
          batchesFailed += 1;
          if (!firstError) firstError = json?.error ?? `Batch offset=${off} failed with status ${res.status}`;
          if (!firstErrorDetail) firstErrorDetail = json?.detail ?? null;
        }

        // tiny pause to reduce burst load
        await sleep(300);
      }

      append("Scan ALL batches (done)", {
        ok: batchesFailed === 0,
        batches_ok: batchesOk,
        batches_failed: batchesFailed,
        first_error: firstError,
        first_error_detail: firstErrorDetail,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      const stack = e instanceof Error ? e.stack ?? null : null;
      append("Scan ALL batches (error)", { ok: false, error: message, detail: stack });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">Autopilot status</div>
          <span
            className={`rounded-full border px-2 py-1 text-xs font-semibold ${
              (autopilotStatusLive?.value?.ok ?? autopilotStatus?.value?.ok) === true
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : (autopilotStatusLive?.value?.ok ?? autopilotStatus?.value?.ok) === false
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            {(autopilotStatusLive?.value?.ok ?? autopilotStatus?.value?.ok) === true
              ? "OK"
              : (autopilotStatusLive?.value?.ok ?? autopilotStatus?.value?.ok) === false
                ? "FAIL"
                : "UNKNOWN"}
          </span>
        </div>
        <div className="text-xs text-slate-600">
          Last autopilot run:{" "}
          <span className="font-mono">{autopilotStatusLive?.updated_at ?? autopilotStatus?.updated_at ?? "—"}</span>
          {" • "}For date:{" "}
          <span className="font-mono">
            {autopilotStatusLive?.value?.date_used ?? autopilotStatus?.value?.date_used ?? "—"}
          </span>
        </div>
        {(autopilotStatusLive?.value?.ok ?? autopilotStatus?.value?.ok) === false &&
        (autopilotStatusLive?.value?.error ?? autopilotStatus?.value?.error) ? (
          <div className="text-xs text-rose-600">
            Error: {autopilotStatusLive?.value?.error ?? autopilotStatus?.value?.error}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-semibold text-slate-900">Daily workflow</div>
        <div className="text-sm text-slate-600">
          Daily: you typically do nothing. Autopilot runs each weekday ~7am SG. Use &quot;Rescan now&quot; if you want to refresh manually.
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={runRescanNow} disabled={!!busy}>
            {busy?.startsWith("Rescan latest completed day") ? "Rescanning..." : "Rescan now"}
          </Button>
          <Button variant="secondary" onClick={runRepairLatestScanState} disabled={!!busy}>
            {busy === "Repair latest scan state" ? "Repairing..." : "Repair latest scan state"}
          </Button>
          <Button variant="secondary" onClick={runFinalizeLatestSignals} disabled={!!busy}>
            {busy === "Finalize latest signals" ? "Finalizing..." : "Finalize latest signals"}
          </Button>
          <a
            href="/diagnostics"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Diagnostics
          </a>
          <Button variant="secondary" onClick={runBackfillAuto} disabled={!!busy || backfillDone}>
            {backfillDone
              ? "Backfill complete"
              : busy?.startsWith(`Backfill ${universeSlug} auto`)
                ? "Backfilling..."
                : "Backfill core_800 (auto)"}
          </Button>
          <Button variant="secondary" onClick={buildCore800} disabled={!!busy}>
            {busy === "Build Core 800 universe" ? "Building..." : "Build / Refresh Core 800"}
          </Button>
        </div>
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          Advanced (rare): manual ingest / batch scan
        </summary>

        <div className="mt-3 space-y-4">
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-900">Ingest history</div>
            <div className="text-sm text-slate-600">
              Fills <span className="font-mono">price_bars</span> so symbols become scan-ready (≥220 bars).
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-500">Batch size</label>
              <input
                className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={ingestBatchSize}
                onChange={(e) => setIngestBatchSize(Number(e.target.value) || 20)}
                inputMode="numeric"
                disabled={!!busy}
              />
              <label className="text-xs text-slate-500">Offset</label>
              <input
                className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={ingestOffset}
                onChange={(e) => setIngestOffset(Number(e.target.value) || 0)}
                inputMode="numeric"
                disabled={!!busy}
              />
              <Button onClick={ingestCoreUniverse} disabled={!!busy}>
                {busy?.startsWith(`Ingest ${universeSlug} history`) ? "Ingesting..." : "Ingest next batch"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-900">Run scan</div>
            <div className="text-sm text-slate-600">
              Runs the daily scan on <span className="font-mono">{universeSlug}</span> for{" "}
              <span className="font-semibold">{strategyLabel}</span>. Use batches to avoid timeouts.
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
          </div>
        </div>
      </details>

      {(autopilotStatusLive?.value?.ok ?? autopilotStatus?.value?.ok) == null ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-600">
            Autopilot status is unknown. Cron will update this after first run.
          </div>
          <div className="mt-2">
            <Button variant="secondary" onClick={runAutopilotNow} disabled={!!busy}>
              {busy === "Run daily autopilot now" ? "Running..." : "Run autopilot now"}
            </Button>
          </div>
        </div>
      ) : null}

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
