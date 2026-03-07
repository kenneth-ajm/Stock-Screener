import TopNav from "@/components/top-nav";

type PortfolioOption = {
  id: string;
  name: string | null;
  is_default?: boolean | null;
};

export default function AppShell({
  currentPath,
  userEmail,
  portfolios,
  children,
}: {
  currentPath: string;
  userEmail: string;
  portfolios: PortfolioOption[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f9f2e7_0%,_#f5efe3_45%,_#f3ecde_100%)] text-slate-900">
      <TopNav currentPath={currentPath} userEmail={userEmail} portfolios={portfolios} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
