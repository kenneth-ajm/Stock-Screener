import Link from "next/link";
import { runDiagnostics } from "@/lib/diagnostics";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

function checkBadge(ok: boolean) {
  return ok ? <Badge variant="buy">OK</Badge> : <Badge variant="avoid">FAIL</Badge>;
}

export default async function DiagnosticsPage() {
  const result = await runDiagnostics();

  const checks = [
    {
      key: "lctd_vs_scans",
      title: "LCTD vs Scans",
      ok: result.checks.lctd_vs_scans.ok,
      details: result.checks.lctd_vs_scans.details,
      examples: [] as unknown[],
    },
    {
      key: "caps",
      title: "Caps",
      ok: result.checks.caps.ok,
      details: result.checks.caps.details,
      examples: [] as unknown[],
    },
    {
      key: "required_fields",
      title: "Required Fields",
      ok: result.checks.required_fields.ok,
      details: { missing_count: result.checks.required_fields.missing_count },
      examples: result.checks.required_fields.examples,
    },
    {
      key: "value_sanity",
      title: "Value Sanity",
      ok: result.checks.value_sanity.ok,
      details: { invalid_count: result.checks.value_sanity.invalid_count },
      examples: result.checks.value_sanity.examples,
    },
    {
      key: "universe_integrity",
      title: "Universe Integrity",
      ok: result.checks.universe_integrity.ok,
      details: { invalid_count: result.checks.universe_integrity.invalid_count },
      examples: result.checks.universe_integrity.examples,
    },
    {
      key: "regime_freshness",
      title: "Regime Freshness",
      ok: result.checks.regime_freshness.ok,
      details: result.checks.regime_freshness.details,
      examples: [] as unknown[],
    },
    {
      key: "portfolio_consistency",
      title: "Portfolio Consistency",
      ok: result.checks.portfolio_consistency.ok,
      details: result.checks.portfolio_consistency.details,
      examples: [] as unknown[],
    },
  ];

  return (
    <div className="container-page px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Diagnostics</h1>
          <div className="mt-1 text-sm muted">
            Data correctness and signal integrity checks for daily scans.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result.ok ? <Badge variant="buy">OVERALL OK</Badge> : <Badge variant="avoid">OVERALL FAIL</Badge>}
          <Link
            href="/screener"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Back to Screener
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader title="Latest Completed Trading Day" />
        <CardContent>
          <div className="text-sm">
            LCTD: <span className="font-mono font-semibold">{result.lctd ?? "—"}</span>
            {" • "}
            Source: <span className="font-mono">{result.lctd_source}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {checks.map((c) => (
          <Card key={c.key}>
            <CardHeader title={c.title} right={checkBadge(c.ok)} />
            <CardContent>
              <pre className="max-h-52 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(c.details, null, 2)}
              </pre>
              {!c.ok && c.examples.length > 0 ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-700">Top issues (up to 5)</div>
                  <pre className="mt-1 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
{JSON.stringify(c.examples, null, 2)}
                  </pre>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
