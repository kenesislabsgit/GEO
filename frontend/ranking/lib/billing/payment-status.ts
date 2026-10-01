export type PaymentConfirmation = {
  plan: string;
  status: string;
  paymentStatus: string;
  providerSubscriptionStatus?: string;
  paymentId?: string | null;
  paymentError?: string | null;
  paymentErrorCode?: string | null;
  currentPeriodEnd: string | null;
};

export type ConfirmationState = "pending" | "confirmed" | "failed" | "cancelled" | "action" | "slow";

export function paymentConfirmationState(result: PaymentConfirmation): ConfirmationState {
  if (result.paymentStatus === "failed") return "failed";
  if (result.paymentStatus === "cancelled" || result.paymentStatus === "canceled") return "cancelled";
  if (["requires_customer_action", "requires_payment_method"].includes(result.paymentStatus)) return "action";
  return result.paymentStatus === "succeeded" && result.status === "active" && result.plan !== "free"
    ? "confirmed" : "pending";
}
