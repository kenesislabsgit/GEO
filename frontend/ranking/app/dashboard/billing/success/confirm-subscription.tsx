"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAN_CONFIG, type PlanId } from "@/lib/billing/entitlements";
import { paymentConfirmationState, type PaymentConfirmation, type ConfirmationState } from "@/lib/billing/payment-status";
import { routes } from "@/lib/routes";

const POLL_MS = 3000;
const MAX_POLLS = 40;

export function ConfirmSubscription({
  returnTo, subscriptionId, paymentId = null, sessionId = null,
}: {
  returnTo: string | null;
  subscriptionId: string | null;
  paymentId?: string | null;
  sessionId?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<ConfirmationState>("pending");
  const [result, setResult] = useState<PaymentConfirmation | null>(null);
  const [retry, setRetry] = useState(0);
  const destination = returnTo ?? routes.dashboard;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const poll = async () => {
      let nextState: ConfirmationState = "pending";
      try {
        const response = await fetch(routes.api.billingConfirm, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionId, paymentId, sessionId }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (controller.signal.aborted) return;
        if (response.ok) {
          const data = await response.json() as PaymentConfirmation;
          if (controller.signal.aborted) return;
          setResult(data);
          nextState = paymentConfirmationState(data);
        } else if ([400, 401, 404].includes(response.status)) {
          nextState = "slow";
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (!subscriptionId && !paymentId && !sessionId) nextState = "slow";
      if (nextState !== "pending") {
        setState(nextState);
        if (nextState === "confirmed") router.refresh();
        return;
      }
      polls += 1;
      if (polls >= MAX_POLLS) {
        setState("slow");
        return;
      }
      setState("pending");
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [router, subscriptionId, paymentId, sessionId, retry]);

  const failed = state === "failed";
  const cancelled = state === "cancelled";
  const needsAction = state === "action";
  return (
    <div className="mx-auto max-w-md">
      <div className="arc-panel p-8 text-center" role="status" aria-live="polite">
        {state === "pending" ? (
          <>
            <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" aria-hidden />
            <h1 className="font-heading mt-4 text-xl font-semibold">Checking payment status</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We are checking this payment with Dodo. Your subscription is not confirmed yet.
            </p>
          </>
        ) : null}

        {state === "confirmed" && result ? (
          <>
            <CheckCircle2 className="mx-auto size-8 text-[color:var(--arc-accent)]" aria-hidden />
            <h1 className="font-heading mt-4 text-xl font-semibold">
              Payment successful
            </h1>
            <p className="mt-2 text-sm">
              You are on the {PLAN_CONFIG[result.plan as PlanId]?.name ?? result.plan} plan.
            </p>
            {result.currentPeriodEnd ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Current period runs until {new Date(result.currentPeriodEnd).toLocaleDateString()}.
              </p>
            ) : null}
            <Button asChild className="mt-6 w-full"><Link href={destination}>Continue</Link></Button>
          </>
        ) : null}

        {failed || cancelled || needsAction ? (
          <>
            <XCircle className="mx-auto size-8 text-destructive" aria-hidden />
            <h1 className="font-heading mt-4 text-xl font-semibold">
              {failed ? "Payment failed" : cancelled ? "Payment cancelled" : "Payment not completed"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {failed
                ? result?.paymentError || "Dodo reported that this payment failed. Your subscription was not activated by this payment. Try another payment method or contact your bank."
                : cancelled
                  ? "Dodo reported that this payment was cancelled. This payment did not activate a subscription."
                  : "Your payment requires another payment method or additional authorization. Return to Billing to try again."}
            </p>
            {result?.paymentErrorCode && result.paymentErrorCode !== "UNKNOWN_ERROR" ? (
              <p className="mt-2 break-words text-xs text-muted-foreground">Provider reason: {result.paymentErrorCode}</p>
            ) : null}
            <Button asChild className="mt-6 w-full"><Link href={routes.billing()}>Return to Billing</Link></Button>
          </>
        ) : null}

        {state === "slow" ? (
          <>
            <CircleAlert className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <h1 className="font-heading mt-4 text-xl font-semibold">Payment status unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We could not confirm this payment. Do not pay again until you check its status in Billing or with support.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button onClick={() => { setState("pending"); setRetry((value) => value + 1); }}>Check again</Button>
              <Button asChild variant="outline"><Link href={routes.billing()}>Go to Billing</Link></Button>
            </div>
          </>
        ) : null}
        {result?.paymentId ? (
          <p className="mt-4 break-all text-xs text-muted-foreground">Payment reference: {result.paymentId}</p>
        ) : null}
      </div>
    </div>
  );
}
