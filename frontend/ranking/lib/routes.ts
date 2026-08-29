/**
 * Central route definitions. Never hardcode these paths elsewhere - 
 * import from here so scan/auth destinations stay consistent.
 */
export const routes = {
  home: "/",
  /** Unauthenticated "run a free audit" CTA: straight into signup with the
   * scan page as the destination - never a scroll to a pricing grid. */
  freeAuditSignup: "/login?mode=signup&returnTo=%2Fdashboard%2Fscans%2Fnew",
  pricing: "/pricing",
  methodology: "/methodology",
  reporting: "/reporting",
  gettingStarted: "/getting-started",
  scale: "/scale",
  providers: "/providers",
  actionCentre: "/action-centre",
  blog: "/blog",
  blogPost: (slug: string) => `/blog/${slug}`,

  login: (opts?: { claim?: string; returnTo?: string; mode?: "signin" | "signup" }) => {
    const params = new URLSearchParams();
    if (opts?.claim) params.set("claim", opts.claim);
    if (opts?.returnTo) params.set("returnTo", opts.returnTo);
    if (opts?.mode) params.set("mode", opts.mode);
    const qs = params.toString();
    return qs ? `/login?${qs}` : "/login";
  },

  publicReport: (slug: string, scanId?: string) =>
    scanId
      ? `/report/${slug}?scan=${encodeURIComponent(scanId)}`
      : `/report/${slug}`,
  claim: (slug: string) => `/claim/${slug}`,

  dashboard: "/dashboard",
  addWebsite: "/dashboard/brands/new",
  brands: "/dashboard/brands",
  brand: (brandId: string) => `/dashboard/brands/${brandId}`,
  brandUpgrade: (brandId: string) => `/dashboard/brands/${brandId}/upgrade`,
  brandSection: (
    brandId: string,
    section: "prompts" | "competitors" | "citations" | "markets" | "actions" | "history",
  ) => `/dashboard/brands/${brandId}/${section}`,

  scans: "/dashboard/scans",
  newScan: (brandId?: string) =>
    brandId
      ? `/dashboard/scans/new?brand=${encodeURIComponent(brandId)}`
      : "/dashboard/scans/new",
  scanProgress: (scanId: string) => `/dashboard/scans/${scanId}`,

  alerts: "/dashboard/alerts",
  checkoutStart: (opts: {
    plan: string;
    interval: "monthly" | "yearly";
    returnTo?: string;
  }) => {
    const params = new URLSearchParams();
    params.set("plan", opts.plan);
    params.set("interval", opts.interval);
    if (opts.returnTo) params.set("returnTo", opts.returnTo);
    return `/dashboard/billing/start?${params.toString()}`;
  },
  billing: (opts?: {
    plan?: string;
    returnTo?: string;
    status?: "cancelled";
    interval?: "monthly" | "yearly";
    checkout?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (opts?.plan) params.set("plan", opts.plan);
    if (opts?.returnTo) params.set("returnTo", opts.returnTo);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.interval) params.set("interval", opts.interval);
    if (opts?.checkout) params.set("checkout", "1");
    const qs = params.toString();
    return qs ? `/dashboard/billing?${qs}` : "/dashboard/billing";
  },
  billingSuccess: (opts?: { returnTo?: string }) => {
    const params = new URLSearchParams();
    if (opts?.returnTo) params.set("returnTo", opts.returnTo);
    const qs = params.toString();
    return qs ? `/dashboard/billing/success?${qs}` : "/dashboard/billing/success";
  },
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",

  api: {
    prompts: "/api/prompts",
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

/**
 * The homepage's "audit my site" field submits as a plain GET form, so the
 * domain arrives as its own `domain` param rather than baked into `returnTo`
 * - a GET form drops any query string already on its own `action` and
 * replaces it with the form's fields. Both /login (the already-signed-in
 * redirect) and LoginForm (the post-signup redirect) need to land on the
 * exact same destination, so the domain -> returnTo resolution lives here
 * once instead of being duplicated in both places.
 */
export function resolveReturnTo(params: {
  returnTo?: string | null;
  domain?: string | null;
}): string | null {
  const explicit = safeReturnTo(params.returnTo);
  if (explicit) return explicit;
  const domain = params.domain?.trim();
  if (!domain) return null;
  return `${routes.newScan()}?domain=${encodeURIComponent(domain)}`;
}
