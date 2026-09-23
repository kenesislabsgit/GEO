import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/site/logo";
import { getOnboardingUser } from "@/lib/auth/session";
import { canonicalDashboardRedirect } from "@/lib/auth/redirects";
import { routes, safeReturnTo } from "@/lib/routes";
import { VerifyEmailCard } from "./verify-email-card";

export const metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getOnboardingUser();
  if (user?.emailVerified) {
    const params = await searchParams;
    redirect(canonicalDashboardRedirect(safeReturnTo(params.returnTo) ?? routes.newScan()));
  }
  return (
    <main id="main-content" tabIndex={-1} className="arc-atmosphere relative flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div aria-hidden className="arc-mesh pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative w-full max-w-sm">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="arc-glass mt-8 p-6 sm:p-8">
          <Suspense>
            <VerifyEmailCard email={user?.email ?? null} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
