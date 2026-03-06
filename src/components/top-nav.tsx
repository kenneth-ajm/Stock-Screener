import Link from "next/link";
import HeaderPortfolioSelector from "@/components/header-portfolio-selector";

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
  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/ideas", label: "Ideas" },
    { href: "/positions", label: "Positions" },
    { href: "/review", label: "Review" },
    { href: "/backtest", label: "Backtest" },
    { href: "/strategy", label: "Strategy" },
  ];

  return (
    <div className="sticky top-0 z-40 border-b border-[#e3d5bf] bg-[#f7f0e4]/95 shadow-[0_1px_0_rgba(111,87,53,0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1.5 rounded-2xl border border-[#e6d9c5] bg-[#fbf6ee] p-1.5">
          {nav.map((item) => {
            const active = currentPath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-3.5 py-1.5 text-sm font-medium tracking-tight transition ${
                  active
                    ? "border border-[#dcc9aa] bg-[#efe2cb] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                    : "text-slate-700 hover:bg-[#f1e8da]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <HeaderPortfolioSelector portfolios={portfolios} />
          <div className="rounded-xl border border-[#dcc9aa] bg-[#f9f1e4] px-3 py-1.5 text-xs font-medium text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
            {userEmail}
          </div>
        </div>
      </div>
    </div>
  );
}
