import { safeReturnTo } from "@/lib/routes";

/** Set by the dashboard proxy so a logged-out visit can return here after login. */
export const REQUEST_PATH_HEADER = "x-arcanoris-path";

function dashboardOrigin() {
  const raw = process.env.DASHBOARD_APP_URL?.trim();
  if (!raw) return null;
  return new URL(raw).origin;
}

export function canonicalDashboardRedirect(path: string) {
  const safePath = safeReturnTo(path) ?? "/dashboard";
  const shouldUseDashboardHost =
    safePath.startsWith("/dashboard") || safePath.startsWith("/admin");
  const origin = shouldUseDashboardHost ? dashboardOrigin() : null;
  return origin ? `${origin}${safePath}` : safePath;
}
