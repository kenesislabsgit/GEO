"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Switch the public report between "anyone with the link" and "only you".
 * Making a report private is a paid feature; making it public is always
 * allowed (free reports are public by design).
 */
export function ReportVisibilityToggle({
  brandId,
  visibility,
  canMakePrivate,
}: {
  brandId: string;
  visibility: "public" | "private";
  canMakePrivate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isPublic = visibility === "public";

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: isPublic ? "private" : "public" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "Could not change report visibility.");
        return;
      }
      toast.success(
        isPublic ? "Report is now private." : "Report is now public.",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (isPublic && !canMakePrivate) {
    return (
      <p className="text-xs text-muted-foreground">
        <Globe className="mr-1 inline size-3" aria-hidden />
        Public report - upgrade to make it private.
      </p>
    );
  }

  return (
    <Button onClick={toggle} disabled={busy} size="sm" variant="outline">
      {isPublic ? (
        <>
          <Lock className="size-3.5" aria-hidden /> Make report private
        </>
      ) : (
        <>
          <Globe className="size-3.5" aria-hidden /> Make report public
        </>
      )}
    </Button>
  );
}
