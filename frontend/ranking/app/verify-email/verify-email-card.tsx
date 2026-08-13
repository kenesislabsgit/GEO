"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { routes } from "@/lib/routes";

export function VerifyEmailCard({ email }: { email: string | null }) {
  const params = useSearchParams();
  const verified = params.get("verified") === "1";
  const linkError = params.get("error");
  const [resent, setResent] = useState(false);
  const [sending, setSending] = useState(false);

  if (verified) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-8 text-[color:var(--rb-accent)]" aria-hidden />
        <h1 className="font-heading mt-4 text-xl font-semibold tracking-tight">
          Email confirmed
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;re all set — run your first audit.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href={routes.newScan()}>Start your audit</Link>
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
          onSend={async () => {
            if (!email) return;
            setSending(true);
            await authClient
              .sendVerificationEmail({
                email,
                callbackURL: `${routes.verifyEmail}?verified=1`,
              })
              .catch(() => {});
            setResent(true);
            setSending(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="text-center">
      <MailCheck className="mx-auto size-8 text-[color:var(--rb-accent)]" aria-hidden />
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
        onSend={async () => {
          if (!email) return;
          setSending(true);
          await authClient
            .sendVerificationEmail({
              email,
              callbackURL: `${routes.verifyEmail}?verified=1`,
            })
            .catch(() => {});
          setResent(true);
          setSending(false);
        }}
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
        "Sent — check your inbox"
      ) : (
        "Resend confirmation email"
      )}
    </Button>
  );
}
