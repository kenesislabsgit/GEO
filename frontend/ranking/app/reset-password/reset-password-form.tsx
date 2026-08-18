"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { authClient } from "@/lib/auth/client";
import { routes } from "@/lib/routes";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The link itself was bad: expired, already used, or mangled.
  if (linkError || !token) {
    return (
      <div className="text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          This link no longer works
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reset links work once and expire after an hour. Request a fresh one
          and use it straight away.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href={routes.forgotPassword}>Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-8 text-[color:var(--arc-accent)]" aria-hidden />
        <h1 className="font-heading mt-4 text-xl font-semibold tracking-tight">
          Password updated
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your new password is set. Sign in with it now.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href={routes.login({ mode: "signin" })}>Sign in</Link>
        </Button>
      </div>
    );
  }

  async function submit() {
    if (loading) return;
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await authClient.resetPassword({
      newPassword: password,
      token: token!,
    });
    if (result.error) {
      setError(
        result.error.message ||
          "The link may have expired - request a new one.",
      );
      setLoading(false);
      return;
    }
    setDone(true);
  }

  return (
    <div>
      <h1 className="font-heading text-xl font-semibold tracking-tight">
        Choose a new password
      </h1>
      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm">Repeat it</FieldLabel>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not reset</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Saving…
              </>
            ) : (
              "Set new password"
            )}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
