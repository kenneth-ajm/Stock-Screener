"use client";

import { usePathname, useSearchParams } from "next/navigation";

export default function RuntimeDiagBanner({
  buildMarker,
  envLabel,
  currentPath,
}: {
  buildMarker: string;
  envLabel: string;
  currentPath: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const diagRaw = String(search.get("diag") ?? "").trim().toLowerCase();
  const show = diagRaw === "1" || diagRaw === "true";
  if (!show) return null;

  return (
    <div className="border-t border-[#e3d5bf] bg-[#fffaf2] px-4 py-2 text-[11px] text-slate-700 sm:px-6 lg:px-8">
      build={buildMarker} • route={pathname || currentPath} • currentPath={currentPath} • env={envLabel}
    </div>
  );
}
