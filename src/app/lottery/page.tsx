import LotteryLabClient from "./LotteryLabClient";

export const metadata = {
  title: "Lottery Lab",
  description: "Historical-pattern analysis for Singapore 4D and TOTO draws.",
};

export default function LotteryPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef6f3_42%,#f7fafc_100%)] text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <LotteryLabClient />
      </div>
    </main>
  );
}
