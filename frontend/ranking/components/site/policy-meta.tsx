import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/constants";

export function PolicyMeta() {
  return (
    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
      <p>
        Last updated: <time dateTime="2026-09-22">22 September 2026</time>.
      </p>
      <p>
        Questions about this policy?{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="underline underline-offset-4"
        >
          {SUPPORT_EMAIL}
        </a>{" "}
        or{" "}
        <Link
          href="/contact?intent=support"
          className="underline underline-offset-4"
        >
          contact account support
        </Link>
        .
      </p>
    </div>
  );
}
