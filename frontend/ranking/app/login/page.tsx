import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/site/logo";
import { googleConfigured } from "@/lib/auth/auth";
import { canonicalDashboardRedirect } from "@/lib/auth/redirects";
import { getSessionUser } from "@/lib/auth/session";
import { resolveReturnTo } from "@/lib/routes";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string; returnTo?: string; domain?: string }>;
}) {
  // A genuinely signed-in person skips the form. This is the real session
  // check, not the cookie-presence guess the middleware makes - a stale
  // cookie lands on the form and can simply sign in again.
  const user = await getSessionUser();
  if (user) {
    const params = await searchParams;
    if (params.claim) redirect(`/claim/${encodeURIComponent(params.claim)}`);
    redirect(canonicalDashboardRedirect(resolveReturnTo(params) ?? "/dashboard"));
  }
  return (
    <main className="arc-atmosphere relative flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div aria-hidden className="arc-mesh pointer-events-none absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="arc-grid pointer-events-none absolute inset-0 opacity-35 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black,transparent)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="arc-glass mt-8 p-6 sm:p-8">
          <Suspense
            fallback={
              <p className="text-center text-sm text-muted-foreground">
                Loading…
              </p>
            }
          >
            {/* Decided on the server: the browser never learns whether the
                keys exist, and a button that cannot work is never rendered. */}
            <LoginForm googleEnabled={googleConfigured} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
