"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { routes } from "@/lib/routes";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const claim = params.get("claim");
  const returnTo = params.get("returnTo");
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
      const res = await fetch("/api/auth/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, mode, claim, returnTo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Auth failed");
      router.push(data.redirect || "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth failed");
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
          ? "Create a local test account to save scan results."
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
        <div className="mt-4 rounded-lg border border-[color:var(--rb-blue)]/30 bg-[color:var(--rb-blue-soft)] px-3.5 py-2.5 text-sm">
          You&apos;re claiming the report for{" "}
          <span className="font-medium">{claim}</span>. It will be attached to
          your new account.
        </div>
      ) : null}

      <form
        className="mt-6"
        action="/api/auth/local"
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input type="hidden" name="mode" value={mode} />
        {claim ? <input type="hidden" name="claim" value={claim} /> : null}
        {returnTo ? (
          <input type="hidden" name="returnTo" value={returnTo} />
        ) : null}
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
            <FieldLabel htmlFor="password">Password</FieldLabel>
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
        Local testing accepts any email with a non-empty password.
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Back to home
        </Link>
      </p>
    </div>
  );
}
