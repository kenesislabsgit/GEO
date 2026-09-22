"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { routes, safeReturnTo } from "@/lib/routes";

export function VerifyEmailCard({ email }: { email: string | null }) {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo")) ?? routes.newScan();
  const linkError = params.get("error");
  const [resent, setResent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!resent) return;
    const timer = setTimeout(() => setResent(false), 60_000);
    return () => clearTimeout(timer);
  }, [resent]);

  async function resend() {
    if (!email) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: returnTo });
      if (result.error) throw new Error(result.error.message || "Could not send confirmation.");
      setResent(true);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not send confirmation. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (linkError) {
    return (
      <div className="text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          This link no longer works
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Confirmation links work once and expire. Send yourself a fresh one.
        </p>
        <ResendButton
          email={email}
          resent={resent}
          sending={sending}
          onSend={resend}
        />
        {sendError ? <p role="alert" className="mt-3 text-sm text-destructive">{sendError}</p> : null}
      </div>
    );
  }

  return (
    <div className="text-center">
      <MailCheck className="mx-auto size-8 text-[color:var(--arc-accent)]" aria-hidden />
      <h1 className="font-heading mt-4 text-xl font-semibold tracking-tight">
        Check your inbox
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {email
          ? `We sent a confirmation link to ${email}.`
          : "We sent you a confirmation link."}{" "}
        Click it to unlock your first audit. You can keep this tab open.
      </p>
      <ResendButton
        email={email}
        resent={resent}
        sending={sending}
        onSend={resend}
      />
      {sendError ? <p role="alert" className="mt-3 text-sm text-destructive">{sendError}</p> : null}
      {email ? (
        <form action="/api/auth/signout" method="post" className="mt-4">
          <button type="submit" className="text-xs text-muted-foreground underline hover:text-foreground">
            Sign out and use a different account
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ResendButton({
  email,
  resent,
  sending,
  onSend,
}: {
  email: string | null;
  resent: boolean;
  sending: boolean;
  onSend: () => Promise<void>;
}) {
  if (!email) {
    return (
      <Button asChild className="mt-6 w-full" variant="outline">
        <Link href={routes.login({ mode: "signin" })}>Sign in to resend</Link>
      </Button>
    );
  }
  return (
    <Button
      className="mt-6 w-full"
      variant="outline"
      disabled={sending || resent}
      onClick={() => void onSend()}
    >
      {sending ? (
        <>
          <Loader2 data-icon="inline-start" className="animate-spin" />
          Sending…
        </>
      ) : resent ? (
        "Sent - check your inbox"
      ) : (
        "Resend confirmation email"
      )}
    </Button>
  );
}
