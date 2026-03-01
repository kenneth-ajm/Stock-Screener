import { Suspense } from "react";
import AuthClient from "./AuthClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <AuthClient />
    </Suspense>
  );
}