"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { routes } from "@/lib/routes";

/**
 * The homepage form no longer runs the audit. Every audit costs real money,
 * so an account comes first: this form carries the typed domain to sign-up,
 * and the new-audit page has it waiting after the account exists. Someone
 * already signed in never sees the login page — the middleware bounces them
 * straight through to the new-audit page.
 */
export function DomainScanForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);

  function continueToSignup() {
    setLoading(true);
    router.push(
      routes.login({
        mode: "signup",
        returnTo: `/dashboard/scans/new?domain=${encodeURIComponent(domain.trim())}`,
      }),
    );
  }

  return (
    <div
      id="scan"
      className="w-full rounded-2xl border border-white/70 bg-white/80 p-1.5 shadow-[0_1px_2px_rgba(12,15,20,0.04),0_24px_64px_rgba(12,15,20,0.1)] backdrop-blur-xl"
    >
      <div className="rounded-[14px] bg-white p-4 sm:p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (domain.trim() && !loading) continueToSignup();
          }}
        >
          <label htmlFor="domain" className="text-sm font-medium">
            Company website
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Globe className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="domain"
                placeholder="yourcompany.com"
                className="h-12 rounded-xl border-border/80 bg-[color:var(--rb-mist)] pl-10 text-base shadow-none focus-visible:bg-white"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button type="submit" size="lg" className="h-12 rounded-xl px-6" disabled={loading || !domain.trim()}>
              Start free audit
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            5 buyer questions · 1 AI provider · free
          </p>
        </form>
      </div>
    </div>
  );
}
