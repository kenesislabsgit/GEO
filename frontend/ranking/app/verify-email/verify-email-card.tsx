"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { routes, safeReturnTo } from "@/lib/routes";

export function VerifyEmailCard({ email }: { email: string | null }) {
  const params = useSearchParams();
  const verified = params.get("verified") === "1";
  const linkError = params.get("error");
  const [resent, setResent] = useState(false);
  const [sending, setSending] = useState(false);
  const returnTo = safeReturnTo(params.get("returnTo")) ?? routes.newScan();
  const callbackURL = `${routes.verifyEmail}?verified=1&returnTo=${encodeURIComponent(returnTo)}`;

  useEffect(() => {
    if (!resent) return;
    const timer = setTimeout(() => setResent(false), 60_000);
    return () => clearTimeout(timer);
  }, [resent]);

  async function resend() {
    if (!email || sending) return;
    setSending(true);
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL });
      if (result.error) throw new Error(result.error.message || "Could not send confirmation email.");
      setResent(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send confirmation email. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (verified) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-8 text-[color:var(--arc-accent)]" aria-hidden />
        <h1 className="font-heading mt-4 text-xl font-semibold tracking-tight">
          Email confirmed
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;re all set - run your first audit.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href={returnTo}>Start your audit</Link>
        </Button>
      </div>
    );
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
      <p className="mt-4 text-xs text-muted-foreground">
        Wrong address?{" "}
        <Link href={routes.settings} className="underline hover:text-foreground">
          Change it in settings
        </Link>
      </p>
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
