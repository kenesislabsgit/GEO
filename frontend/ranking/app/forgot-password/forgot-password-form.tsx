"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";
import { routes } from "@/lib/routes";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (loading) return;
    setLoading(true);
    // Deliberately the same outcome whether or not the address has an
    // account: this page must not be usable to discover who has signed up.
    await authClient
      .requestPasswordReset({ email, redirectTo: routes.resetPassword })
      .catch(() => {});
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto size-8 text-[color:var(--arc-accent)]" aria-hidden />
        <h1 className="font-heading mt-4 text-xl font-semibold tracking-tight">
          Check your inbox
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          If an account exists for {email || "that address"}, a reset link is
          on its way. The link works for one hour.
        </p>
        <p className="mt-4 text-sm">
          <Link
            href={routes.login({ mode: "signin" })}
            className="text-muted-foreground underline hover:text-foreground"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-heading text-xl font-semibold tracking-tight">
        Forgot your password?
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your account email and we&apos;ll send a reset link. If you sign
        in with Google, just use the Google button instead - there is no
        password to reset.
      </p>
      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void submit();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
            {loading ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-5 text-center text-sm">
        <Link
          href={routes.login({ mode: "signin" })}
          className="text-muted-foreground underline hover:text-foreground"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
