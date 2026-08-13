/**
 * Central route definitions. Never hardcode these paths elsewhere —
 * import from here so scan/auth destinations stay consistent.
 */
export const routes = {
  home: "/",
  publicScanAnchor: "/#plans",
  pricing: "/pricing",
  methodology: "/methodology",

  login: (opts?: { claim?: string; returnTo?: string; mode?: "signin" | "signup" }) => {
    const params = new URLSearchParams();
    if (opts?.claim) params.set("claim", opts.claim);
    if (opts?.returnTo) params.set("returnTo", opts.returnTo);
    if (opts?.mode) params.set("mode", opts.mode);
    const qs = params.toString();
    return qs ? `/login?${qs}` : "/login";
  },

  publicScanProgress: (scanId: string) => `/scan/${scanId}`,
  publicReport: (slug: string) => `/report/${slug}`,

  dashboard: "/dashboard",
  brands: "/dashboard/brands",
  brand: (brandId: string) => `/dashboard/brands/${brandId}`,
  brandUpgrade: (brandId: string) => `/dashboard/brands/${brandId}/upgrade`,
  brandSection: (
    brandId: string,
    section: "prompts" | "competitors" | "citations" | "actions" | "history",
  ) => `/dashboard/brands/${brandId}/${section}`,

  scans: "/dashboard/scans",
  newScan: (brandId?: string) =>
    brandId
      ? `/dashboard/scans/new?brand=${encodeURIComponent(brandId)}`
      : "/dashboard/scans/new",
  scanProgress: (scanId: string) => `/dashboard/scans/${scanId}`,

  alerts: "/dashboard/alerts",
  billing: (opts?: { plan?: string; returnTo?: string; status?: "cancelled" }) => {
    const params = new URLSearchParams();
    if (opts?.plan) params.set("plan", opts.plan);
    if (opts?.returnTo) params.set("returnTo", opts.returnTo);
    if (opts?.status) params.set("status", opts.status);
    const qs = params.toString();
    return qs ? `/dashboard/billing?${qs}` : "/dashboard/billing";
  },
  billingSuccess: (opts?: { returnTo?: string }) => {
    const params = new URLSearchParams();
    if (opts?.returnTo) params.set("returnTo", opts.returnTo);
    const qs = params.toString();
    return qs ? `/dashboard/billing/success?${qs}` : "/dashboard/billing/success";
  },
  onboarding: "/dashboard/onboarding",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",

  api: {
    prompts: "/api/prompts",
    onboarding: "/api/onboarding",
    billingStatus: "/api/billing/status",
    billingConfirm: "/api/billing/confirm",
    alerts: "/api/alerts",
  },
  settings: "/dashboard/settings",
  admin: "/admin",

  refund: "/refund",
  contact: "/contact",
  dataHandling: "/data-handling",
  privacy: "/privacy",
  terms: "/terms",

  brandExport: (brandId: string, type: string) =>
    `/api/brands/${encodeURIComponent(brandId)}/export?type=${encodeURIComponent(type)}`,
} as const;

/**
 * Only allow same-origin path redirects (no protocol-relative or absolute
 * URLs) so returnTo params cannot be abused for open redirects.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  return value;
}
