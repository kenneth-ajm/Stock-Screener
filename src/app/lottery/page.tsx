import AppShell from "@/components/app-shell";
import { getWorkspaceContext } from "@/lib/workspace_context";
import LotteryLabClient from "./LotteryLabClient";

export const dynamic = "force-dynamic";

export default async function LotteryPage() {
  const { user, portfolios } = await getWorkspaceContext("/lottery");

  return (
    <AppShell currentPath="/lottery" userEmail={user.email ?? ""} portfolios={portfolios}>
      <LotteryLabClient />
    </AppShell>
  );
}
