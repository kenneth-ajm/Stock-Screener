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
  const nav = [
    { href: "/dashboard", label: "Trade Desk" },
    { href: "/today", label: "Today" },
    { href: "/swing", label: "This Week" },
    { href: "/long-term", label: "Long-Term" },
    { href: "/positions", label: "Positions" },
    { href: "/review", label: "Journal" },
    { href: "/ideas", label: "Strategy Lab" },
  ];

  return (
    <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-sm">
          {nav.map((item) => {
            const active = currentPath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium tracking-tight transition-all ${
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-white hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <HeaderPortfolioSelector portfolios={portfolios} />
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            {userEmail}
          </div>
        </div>
      </div>
      <RuntimeDiagBanner buildMarker={buildMarker} envLabel={envLabel} currentPath={currentPath} />
    </div>
  );
}
