import { safeReturnTo } from "@/lib/routes";

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
