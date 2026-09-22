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
import { selectedTrial, trialCommitment } from "@/lib/billing/pricing";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function typedAuditUrl(raw: string): string {
  const host = raw.trim().replace(/^(https?:\/\/)+/i, "").replace(/\/+$/, "");
  return host ? `https://${host}` : "";
}

export function LoginForm({
  googleEnabled = false,
  emailVerificationEnabled = false,
}: {
  googleEnabled?: boolean;
  emailVerificationEnabled?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const claim = params.get("claim");
  const requestedDomain = params.get("domain")?.trim() ?? "";
  const auditUrl = typedAuditUrl(requestedDomain);
  const mode = params.get("mode") === "signup" ? "signup" : "signin";
  // The hero's "audit my site" field arrives as its own `domain` param, not
  // baked into returnTo (a GET form drops any query string on its own
  // action) - resolveReturnTo turns that into the same destination
  // /login's server-side already-signed-in redirect would land on.
  const returnTo = resolveReturnTo({
    returnTo: params.get("returnTo"),
    domain: params.get("domain"),
    mode,
  });
  const trial = selectedTrial(returnTo);
  const authError = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const needsAgreement = mode === "signup" && !termsAccepted;
  const passwordLengthValid =
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH;
  const modeHref = (nextMode: "signin" | "signup") =>
    routes.login({
      mode: nextMode,
      ...(claim ? { claim } : {}),
      ...(returnTo ? { returnTo } : {}),
      ...(requestedDomain ? { domain: requestedDomain } : {}),
    });

  async function submit() {
    if (loading || needsAgreement) return;
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
              callbackURL: returnTo ?? routes.newScan(),
            })
          : await signIn.email({ email, password });
      if (attempt.error) {
        throw new Error(attempt.error.message || "Could not sign in.");
      }
      if (mode === "signup" && emailVerificationEnabled) {
        const destination = returnTo ?? routes.newScan();
        router.push(
          `${routes.verifyEmail}?returnTo=${encodeURIComponent(destination)}`,
        );
        return;
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
      {auditUrl ? (
        <div className="mb-5">
          <p className="break-all font-mono text-sm font-medium">{auditUrl}</p>
          <p className="mt-1 text-sm text-muted-foreground">You&apos;re about to audit this site.</p>
        </div>
      ) : null}
      <h1 className="font-heading text-xl font-semibold tracking-tight">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "signup"
          ? requestedDomain
            ? emailVerificationEnabled
              ? `We'll audit ${requestedDomain} as soon as you confirm your email.`
              : `We'll audit ${requestedDomain} as soon as you create your account.`
            : emailVerificationEnabled
              ? "We'll start your first audit as soon as you confirm your email."
              : "We'll take you straight to your first audit."
          : "Sign in to your dashboard."}
      </p>

      {trial ? (
        <section aria-label="Selected trial" className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
          <h2 className="text-sm font-semibold">Plus · {trial.interval === "yearly" ? "Yearly" : "Monthly"} · {trial.plan.trialDays}-day trial</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{trialCommitment(trial.interval)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Your trial starts after checkout, not when you create this account.</p>
        </section>
      ) : null}

      <div className="mt-5 grid grid-cols-2 rounded-xl bg-muted p-1">
        <Link href={modeHref("signin")} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${mode === "signin" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Sign in</Link>
        <Link href={modeHref("signup")} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Sign up</Link>
      </div>

      {claim ? (
        <div className="mt-4 rounded-lg border border-[color:var(--arc-accent)]/30 bg-[color:var(--arc-accent-soft)] px-3.5 py-2.5 text-sm">
          You&apos;re claiming the audit for{" "}
          <span className="font-medium">{claim}</span>. It will be attached to
          your new account.
        </div>
      ) : null}

      {/* Above the email fields on purpose: most people who have a Google
          account will use it, and putting it under the form makes them fill
          in a password first and find the shortcut afterwards. */}
      {googleEnabled ? (
        <div className="mt-6">
          <GoogleButton claim={claim} returnTo={returnTo} disabled={needsAgreement || loading} />
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
            {mode === "signup" ? (
              <p
                aria-live="polite"
                className={`text-xs ${
                  password.length === 0
                    ? "text-muted-foreground"
                    : passwordLengthValid
                      ? "text-[color:var(--arc-green)]"
                      : "text-destructive"
                }`}
              >
                {password.length === 0
                  ? "Use 8 to 128 characters."
                  : password.length < MIN_PASSWORD_LENGTH
                    ? `${MIN_PASSWORD_LENGTH - password.length} more character${MIN_PASSWORD_LENGTH - password.length === 1 ? "" : "s"} needed.`
                    : password.length > MAX_PASSWORD_LENGTH
                      ? "Password must be 128 characters or fewer."
                      : "Password length is valid."}
              </p>
            ) : null}
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
              minLength={mode === "signup" ? MIN_PASSWORD_LENGTH : undefined}
              maxLength={mode === "signup" ? MAX_PASSWORD_LENGTH : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error || authError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not continue</AlertTitle>
              <AlertDescription>{error || authError}</AlertDescription>
            </Alert>
          ) : null}
          {mode === "signup" ? (
            <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <input id="signup-terms" type="checkbox" required checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-foreground" />
              <label htmlFor="signup-terms" className="cursor-pointer">I agree to the <Link href={routes.terms} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline underline-offset-4 hover:text-foreground">Terms and Conditions</Link>.</label>
            </div>
          ) : null}
          <Button type="submit" className="w-full" disabled={loading || needsAgreement}>
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
        {mode === "signup" ? <><Link href={routes.privacy} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Privacy Policy</Link><span aria-hidden className="mx-2">·</span></> : null}
        <Link href="/" className="hover:text-foreground">
          Back to home
        </Link>
      </p>
    </div>
  );
}
