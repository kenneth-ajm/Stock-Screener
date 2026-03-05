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
    { href: "/strategy", label: "Strategy" },
  ];

  return (
    <div className="sticky top-0 z-40 border-b border-[#e8dcc8] bg-[#f7f1e6]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          {nav.map((item) => {
            const active = currentPath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-[#ede1cf] text-slate-900"
                    : "text-slate-700 hover:bg-[#efe5d6]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <HeaderPortfolioSelector portfolios={portfolios} />
          <div className="rounded-xl border border-[#e8dcc8] bg-[#fffaf2] px-3 py-1.5 text-xs text-slate-600">
            {userEmail}
          </div>
        </div>
      </div>
    </div>
  );
}
