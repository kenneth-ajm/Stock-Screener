import Link from "next/link";
import HeaderPortfolioSelector from "@/components/header-portfolio-selector";
import RuntimeDiagBanner from "@/components/runtime-diag-banner";
import { getBuildMarker, getEnvironmentLabel } from "@/lib/build_marker";

type PortfolioOption = {
  id: string;
  name: string | null;
  is_default?: boolean | null;
};

export default function TopNav({
  currentPath,
  userEmail,
  portfolios,
}: {
  currentPath: string;
  userEmail: string;
  portfolios: PortfolioOption[];
}) {
  const buildMarker = getBuildMarker();
  const envLabel = getEnvironmentLabel();
  const primary = [
    { href: "/today", label: "Today" },
    { href: "/positions", label: "Positions" },
    { href: "/paper", label: "Paper" },
    { href: "/review", label: "Journal" },
    { href: "/ideas", label: "Research" },
  ];
  const secondary = [
    { href: "/dashboard", label: "Ticker Check & Overview" },
    { href: "/broker", label: "Broker (read-only)" },
    { href: "/system", label: "System Status" },
  ];
  const secondaryActive = secondary.some((item) => currentPath === item.href);

  return (
    <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/today" className="hidden whitespace-nowrap text-sm font-semibold tracking-tight text-slate-950 sm:block">
            Stock Screener
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-sm" aria-label="Primary">
            {primary.map((item) => {
              const active = currentPath === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium tracking-tight transition-all sm:px-3 ${
                    active
                      ? "border border-emerald-200 bg-white text-emerald-800 shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <details className="group relative">
              <summary
                className={`cursor-pointer list-none whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium tracking-tight sm:px-3 ${
                  secondaryActive ? "border border-emerald-200 bg-white text-emerald-800 shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900"
                }`}
              >
                More
              </summary>
              <div className="fixed left-4 top-[58px] z-50 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-10">
                {secondary.map((item) => (
                  <Link key={item.href} href={item.href} className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-950">
                    {item.label}
                  </Link>
                ))}
              </div>
            </details>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HeaderPortfolioSelector portfolios={portfolios} />
          <div className="hidden rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm xl:block">
            {userEmail}
          </div>
        </div>
      </div>
      <RuntimeDiagBanner buildMarker={buildMarker} envLabel={envLabel} currentPath={currentPath} />
    </div>
  );
}
