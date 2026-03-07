export const BUILD_MARKER = "build-2026-03-08-1";

export function getBuildMarker() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
    process.env.NEXT_PUBLIC_APP_BUILD_ID ??
    BUILD_MARKER
  );
}

export function getEnvironmentLabel() {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
}
