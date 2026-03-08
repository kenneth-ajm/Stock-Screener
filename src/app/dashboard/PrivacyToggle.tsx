"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "dashboard-private-mode";

function readPrivateMode() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export default function PrivacyToggle() {
  const [isPrivateMode, setIsPrivateMode] = useState(false);

  useEffect(() => {
    setIsPrivateMode(readPrivateMode());
  }, []);

  function toggle() {
    const next = !isPrivateMode;
    setIsPrivateMode(next);
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event("dashboard-private-mode-change"));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-xl border border-[#dccfb9] bg-[#f7f1e4] px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-[#f0e7d6]"
    >
      {isPrivateMode ? "Show values" : "Hide values"}
    </button>
  );
}

