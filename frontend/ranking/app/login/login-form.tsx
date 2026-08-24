"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { resolveReturnTo, routes } from "@/lib/routes";
import { signIn, signUp } from "@/lib/auth/client";
import { GoogleButton } from "./google-button";

export function LoginForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const claim = params.get("claim");
  // The hero's "audit my site" field arrives as its own `domain` param, not
  // baked into returnTo (a GET form drops any query string on its own
  // action) - resolveReturnTo turns that into the same destination
  // /login's server-side already-signed-in redirect would land on.
  const returnTo = resolveReturnTo({
    returnTo: params.get("returnTo"),
    domain: params.get("domain"),
  });
  const mode = params.get("mode") === "signup" ? "signup" : "signin";
  const authError = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const modeHref = (nextMode: "signin" | "signup") =>
    routes.login({
      mode: nextMode,
      ...(claim ? { claim } : {}),
      ...(returnTo ? { returnTo } : {}),
    });

  async function submit() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      // Real accounts, real passwords: Better Auth checks the credentials and
      // sets the session cookie. Only then does /api/auth/complete attach any
      // claimed report and decide where to land.
      const attempt =
        mode === "signup"
          ? await signUp.email({
              email,
              password,
              name: email.split("@")[0] || email,
            })
          : await signIn.email({ email, password });
      if (attempt.error) {
        throw new Error(attempt.error.message || "Could not sign in.");
      }
      const res = await fetch("/api/auth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim, returnTo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not sign in.");
      const redirectTo =
        typeof data.redirect === "string" ? data.redirect : "/dashboard";
      if (/^https?:\/\//i.test(redirectTo)) {
        window.location.assign(redirectTo);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="font-heading text-xl font-semibold tracking-tight">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "signup"
          ? "Create an account to save your audits."
          : "Sign in to your dashboard."}
      </p>

      <div className="mt-5 grid grid-cols-2 rounded-xl bg-muted p-1">
        <Link
          href={modeHref("signin")}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            mode === "signin" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Sign in
        </Link>
        <Link
          href={modeHref("signup")}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Sign up
        </Link>
      </div>

      {claim ? (
        <div className="mt-4 rounded-lg border border-[color:var(--arc-accent)]/30 bg-[color:var(--arc-accent-soft)] px-3.5 py-2.5 text-sm">
          You&apos;re claiming the report for{" "}
          <span className="font-medium">{claim}</span>. It will be attached to
          your new account.
        </div>
      ) : null}

      {/* Above the email fields on purpose: most people who have a Google
          account will use it, and putting it under the form makes them fill
          in a password first and find the shortcut afterwards. */}
      {googleEnabled ? (
        <div className="mt-6">
          <GoogleButton claim={claim} returnTo={returnTo} />
          <div className="mt-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      ) : null}

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              {mode === "signin" ? (
                <Link
                  href={routes.forgotPassword}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Forgot password?
                </Link>
              ) : null}
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="Password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error || authError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not continue</AlertTitle>
              <AlertDescription>{error || authError}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Working...
              </>
            ) : mode === "signup" ? (
              "Create account"
            ) : (
              "Sign in"
            )}
          </Button>
        </FieldGroup>
      </form>

      <div className="mt-5 border-t border-border pt-4 text-center">
        <Link
          href={modeHref(mode === "signup" ? "signin" : "signup")}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "Need an account? Sign up"}
        </Link>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Back to home
        </Link>
      </p>
    </div>
  );
}
