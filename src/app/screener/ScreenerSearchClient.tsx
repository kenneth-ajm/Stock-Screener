"use client";

import { useState } from "react";

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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* Header stays fixed */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div className="text-base font-semibold text-slate-900">{title}</div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>

          {/* Body scrolls */}
          <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function ScreenerSearchClient() {
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const s = symbol.trim().toUpperCase();
    if (!s) return;

    try {
      setBusy(true);
      setError(null);
      setResult(null);

      const res = await fetch("/api/score-symbol", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: s }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Score failed");

      setResult(json);
      setOpen(true);
    } catch (e: any) {
      setError(e?.message ?? "Score failed");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          placeholder="Check ticker (e.g. TSLA)"
          className="w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
        />
        <button
          className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          onClick={run}
          disabled={busy}
        >
          {busy ? "Checking..." : "Check"}
        </button>
      </div>

      <Modal open={open} title="Ticker score" onClose={() => setOpen(false)}>
        {error ? (
          <div className="text-sm text-rose-600">{error}</div>
        ) : result ? (
          <div className="space-y-4 text-sm text-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold">{result.symbol}</span>
                {result.scanDate ? (
                  <span className="text-slate-500"> • {result.scanDate}</span>
                ) : null}
              </div>

              {result.signal ? (
                <div className="text-right">
                  <div className="text-xs text-slate-500">Signal</div>
                  <div className="font-semibold">{result.signal}</div>
                </div>
              ) : null}
            </div>

            {typeof result.confidence === "number" ? (
              <div className="text-slate-700">
                Confidence: <span className="font-semibold">{result.confidence}</span>
              </div>
            ) : null}

            {result.reason_summary ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-600">Summary</div>
                <div className="mt-1">{result.reason_summary}</div>
              </div>
            ) : null}

            {result.reason_json ? (
              <details className="rounded-xl border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                  More details (technical)
                </summary>
                <pre className="mt-2 max-h-[45vh] overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  {JSON.stringify(result.reason_json, null, 2)}
                </pre>
              </details>
            ) : (
              <div className="text-xs text-slate-500">
                (No detailed JSON available.)
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}