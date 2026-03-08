"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/currency_display";

const STORAGE_KEY = "dashboard-private-mode";

function readPrivateMode() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export default function PrivacyMoney({
  value,
  className = "",
}: {
  value: number | null | undefined;
  className?: string;
}) {
  const [isPrivateMode, setIsPrivateMode] = useState(false);

  useEffect(() => {
    const sync = () => setIsPrivateMode(readPrivateMode());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      sync();
    };
    const onPrivacyToggle = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("dashboard-private-mode-change", onPrivacyToggle as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("dashboard-private-mode-change", onPrivacyToggle as EventListener);
    };
  }, []);

  return <span className={className}>{formatCurrency(value, isPrivateMode)}</span>;
}

