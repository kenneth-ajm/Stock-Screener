"use client";

import { useMemo, useState } from "react";
import {
  analyzeFourD,
  analyzeToto,
  parseFourDHistory,
  parseTotoHistory,
  type FourDAnalysis,
  type TotoAnalysis,
} from "@/lib/lottery/analyzer";

type Tab = "4d" | "toto";

const FOUR_D_SAMPLE = `date,draw_no,first,second,third,starter,consolation
2026-01-03,5401,1234,5678,9012,"1111 2222 3333","4444 5555 6666"
2026-01-07,5402,2345,6789,0123,"7777 8888 9999","1357 2468 3690"`;

const TOTO_SAMPLE = `date,draw_no,n1,n2,n3,n4,n5,n6,additional
2026-01-05,4101,3,8,12,19,33,45,27
2026-01-08,4102,1,10,14,25,38,49,6`;

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function fixed(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}

function Notice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      Lottery draws are designed to be random. This lab ranks numbers by imported historical patterns and then checks
      those rules against past draws; it should be treated as entertainment analysis, not a guaranteed probability edge.
    </div>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <div className="font-medium">Rows skipped</div>
      <ul className="mt-2 space-y-1">
        {errors.slice(0, 5).map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
      {errors.length > 5 ? <div className="mt-1 text-xs">Plus {errors.length - 5} more.</div> : null}
    </div>
  );
}

function FourDResults({ analysis }: { analysis: FourDAnalysis | null }) {
  if (!analysis) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
        Paste 4D history and run the scan to generate three pattern-ranked numbers.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Draws Imported" value={String(analysis.drawCount)} detail={analysis.latestDate ? `Latest ${analysis.latestDate}` : "No latest date"} />
        <Metric label="Backtest Window" value={String(analysis.backtest.testedDraws)} detail="Rolling one-draw-ahead tests" />
        <Metric label="Top-3 Hits" value={String(analysis.backtest.top3Hits)} detail={`${pct(analysis.backtest.hitRatePct)} hit rate`} />
        <Metric label="Random Baseline" value={fixed(analysis.backtest.randomExpectedHits, 3)} detail="Expected hits for 3 exact tickets" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {analysis.picks.map((pick, index) => (
          <div key={pick.number} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Set {index + 1}</div>
              <div className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">
                score {fixed(pick.score, 1)}
              </div>
            </div>
            <div className="mt-3 font-mono text-4xl font-semibold tracking-normal text-slate-950">{pick.number}</div>
            <div className="mt-3 space-y-1 text-xs text-slate-600">
              {pick.reasons.slice(0, 3).map((reason) => (
                <div key={reason}>{reason}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Most Frequent Imported Top-3 Numbers</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {analysis.hotTop3.map((row) => (
            <div key={row.number} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
              <span className="font-mono font-semibold">{row.number}</span>
              <span className="text-slate-500">{row.count} hits</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TotoResults({ analysis }: { analysis: TotoAnalysis | null }) {
  if (!analysis) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
        Paste TOTO history and run the scan to generate three pattern-ranked ticket sets.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Draws Imported" value={String(analysis.drawCount)} detail={analysis.latestDate ? `Latest ${analysis.latestDate}` : "No latest date"} />
        <Metric label="Backtest Window" value={String(analysis.backtest.testedDraws)} detail="Rolling one-draw-ahead tests" />
        <Metric label="Group 1 Hits" value={String(analysis.backtest.groupOneHits)} detail="Six main numbers matched" />
        <Metric label="Best Avg Match" value={fixed(analysis.backtest.averageBestMatches, 2)} detail="Best of 3 sets per tested draw" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {analysis.picks.map((pick, index) => (
          <div key={pick.numbers.join("-")} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Set {index + 1}</div>
              <div className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">
                score {fixed(pick.score, 1)}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {pick.numbers.map((number) => (
                <span
                  key={number}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-slate-950 text-sm font-semibold text-white"
                >
                  {number}
                </span>
              ))}
            </div>
            <div className="mt-3 text-xs text-slate-600">
              Additional lean: <span className="font-semibold text-slate-900">{pick.additionalLean ?? "n/a"}</span>
            </div>
            <div className="mt-2 space-y-1 text-xs text-slate-600">
              {pick.reasons.map((reason) => (
                <div key={reason}>{reason}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Most Frequent Imported TOTO Main Numbers</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {analysis.hotNumbers.map((row) => (
            <div key={row.number} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
              <span className="font-semibold">{row.number}</span>
              <span className="text-slate-500">{fixed(row.count, 1)} score</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Random Group 1 baseline for this backtest window: {fixed(analysis.backtest.randomExpectedGroupOneHits, 6)} expected hits.
        </div>
      </div>
    </div>
  );
}

export default function LotteryLabClient() {
  const [tab, setTab] = useState<Tab>("4d");
  const [fourDText, setFourDText] = useState("");
  const [totoText, setTotoText] = useState("");
  const [fourDAnalysis, setFourDAnalysis] = useState<FourDAnalysis | null>(null);
  const [totoAnalysis, setTotoAnalysis] = useState<TotoAnalysis | null>(null);

  const fourDParsed = useMemo(() => parseFourDHistory(fourDText), [fourDText]);
  const totoParsed = useMemo(() => parseTotoHistory(totoText), [totoText]);

  function runFourD() {
    setFourDAnalysis(analyzeFourD(fourDParsed.draws));
  }

  function runToto() {
    setTotoAnalysis(analyzeToto(totoParsed.draws));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Lottery Lab</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Import Singapore Pools 4D and TOTO history, score historical patterns, and generate three transparent
            candidate sets with a rolling backtest beside them.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setTab("4d")}
            className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "4d" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            4D
          </button>
          <button
            type="button"
            onClick={() => setTab("toto")}
            className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "toto" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            TOTO
          </button>
        </div>
      </div>

      <Notice />

      {tab === "4d" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <div className="text-sm font-semibold text-slate-900">4D History Import</div>
              <p className="mt-1 text-xs text-slate-500">
                Best format: CSV with date, draw_no, first, second, third, starter, consolation. Full historical exports
                can be pasted here without touching the trading database.
              </p>
            </div>
            <textarea
              value={fourDText}
              onChange={(event) => setFourDText(event.target.value)}
              placeholder={FOUR_D_SAMPLE}
              className="min-h-[360px] w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900 outline-none ring-slate-300 focus:bg-white focus:ring-2"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                Parsed {fourDParsed.draws.length} draws. {fourDParsed.errors.length ? `${fourDParsed.errors.length} skipped rows.` : "No skipped rows."}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFourDText(FOUR_D_SAMPLE)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Load Sample Format
                </button>
                <button
                  type="button"
                  onClick={runFourD}
                  disabled={fourDParsed.draws.length === 0}
                  className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run 4D Scan
                </button>
              </div>
            </div>
            <ErrorList errors={fourDParsed.errors} />
          </div>
          <FourDResults analysis={fourDAnalysis} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <div className="text-sm font-semibold text-slate-900">TOTO History Import</div>
              <p className="mt-1 text-xs text-slate-500">
                Best format: CSV with date, draw_no, n1, n2, n3, n4, n5, n6, additional. The scanner ranks main-number
                sets and separately shows an additional-number lean.
              </p>
            </div>
            <textarea
              value={totoText}
              onChange={(event) => setTotoText(event.target.value)}
              placeholder={TOTO_SAMPLE}
              className="min-h-[360px] w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900 outline-none ring-slate-300 focus:bg-white focus:ring-2"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                Parsed {totoParsed.draws.length} draws. {totoParsed.errors.length ? `${totoParsed.errors.length} skipped rows.` : "No skipped rows."}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTotoText(TOTO_SAMPLE)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Load Sample Format
                </button>
                <button
                  type="button"
                  onClick={runToto}
                  disabled={totoParsed.draws.length === 0}
                  className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run TOTO Scan
                </button>
              </div>
            </div>
            <ErrorList errors={totoParsed.errors} />
          </div>
          <TotoResults analysis={totoAnalysis} />
        </div>
      )}
    </div>
  );
}
