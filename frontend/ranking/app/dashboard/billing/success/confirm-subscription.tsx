"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

type BillingStatus = {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  onboardingComplete: boolean;
};

const POLL_MS = 3000;
// Webhooks normally land within seconds; two minutes of patience covers a
// slow retry without pretending failure to someone whose card was charged.
const MAX_POLLS = 40;

export function ConfirmSubscription({
  returnTo,
  subscriptionId,
}: {
  returnTo: string | null;
  subscriptionId: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"pending" | "confirmed" | "slow">("pending");
  const [confirmed, setConfirmed] = useState<BillingStatus | null>(null);
  const polls = useRef(0);
  const askedServer = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const destination = useCallback(
    (status: BillingStatus) =>
      status.onboardingComplete
        ? (returnTo ?? routes.dashboard)
        : routes.onboarding,
    [returnTo],
  );

  const poll = useCallback(async () => {
    let status: BillingStatus | null = null;
    try {
      if (!askedServer.current) {
        // First ask the server to reconcile with Dodo directly — webhooks
        // can be slow, and on localhost they never arrive at all.
        askedServer.current = true;
        const res = await fetch(routes.api.billingConfirm, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionId }),
        });
        if (res.ok) status = (await res.json()) as BillingStatus;
      } else {
        const res = await fetch(routes.api.billingStatus);
        if (res.ok) status = (await res.json()) as BillingStatus;
      }
    } catch {
      // A dropped poll is not a failed payment; just ask again.
    }
    if (status && (status.status === "active" || status.status === "trialing")) {
      setConfirmed(status);
      setState("confirmed");
      router.refresh(); // server-rendered pages pick up the new plan
      return;
    }
    polls.current += 1;
    if (polls.current >= MAX_POLLS) {
      setState("slow");
      return;
    }
    timer.current = setTimeout(() => void poll(), POLL_MS);
  }, [router, subscriptionId]);

  useEffect(() => {
    void poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  return (
    <div className="mx-auto max-w-md">
      <div className="rb-panel p-8 text-center">
        {state === "pending" ? (
          <>
            <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" aria-hidden />
            <h1 className="font-heading mt-4 text-xl font-semibold tracking-tight">
              Confirming your subscription
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your payment provider is telling us the payment went through.
              This usually takes a few seconds — you can leave this page and
              your plan will still activate.
            </p>
          </>
        ) : null}

        {state === "confirmed" && confirmed ? (
          <>
            <CheckCircle2 className="mx-auto size-8 text-[color:var(--rb-accent)]" aria-hidden />
            <h1 className="font-heading mt-4 text-xl font-semibold tracking-tight">
              You&apos;re on the {confirmed.plan === "founder" ? "Pro" : confirmed.plan === "growth" ? "Pro+" : "Agency"} plan
            </h1>
            {confirmed.currentPeriodEnd ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Current period runs until{" "}
                {new Date(confirmed.currentPeriodEnd).toLocaleDateString()}.
              </p>
            ) : null}
            <Button asChild className="mt-6 w-full">
              <Link href={destination(confirmed)}>
                {confirmed.onboardingComplete ? "Continue" : "Set up your audit"}
              </Link>
            </Button>
          </>
        ) : null}

        {state === "slow" ? (
          <>
            <h1 className="font-heading text-xl font-semibold tracking-tight">
              Taking longer than usual
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your payment is not lost — confirmation is just slow to arrive.
              Check again in a moment, or come back later; your plan activates
              automatically once confirmation lands.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button
                onClick={() => {
                  polls.current = 0;
                  askedServer.current = false; // re-reconcile with Dodo
                  setState("pending");
                  void poll();
                }}
              >
                Check again
              </Button>
              <Button asChild variant="outline">
                <Link href={routes.dashboard}>Go to dashboard</Link>
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
