import { Suspense } from "react";
import { Logo } from "@/components/site/logo";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <main className="rb-atmosphere relative flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div aria-hidden className="rb-mesh pointer-events-none absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="rb-grid pointer-events-none absolute inset-0 opacity-35 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black,transparent)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="rb-glass mt-8 p-6 sm:p-8">
          <Suspense
            fallback={
              <p className="text-center text-sm text-muted-foreground">
                Loading…
              </p>
            }
          >
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
