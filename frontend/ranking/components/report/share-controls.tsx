"use client";

import { useState } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { toast } from "sonner";

export function ShareControls({
  slug,
  brandName,
  score,
  scanId,
}: {
  slug: string;
  brandName: string;
  score: number;
  scanId: string;
}) {
  const [copied, setCopied] = useState(false);

  function reportUrl(): string {
    return `${window.location.origin}${routes.publicReport(slug, scanId)}`;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(reportUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the link. Please copy it from your address bar.");
    }
  }

  function shareOnX() {
    const text = `${brandName} scored ${score}/100 on AI visibility. See which AI engines recommend it:`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(reportUrl())}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={copyLink}
        className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
      >
        {copied ? (
          <>
            <Check data-icon="inline-start" />
            Copied
          </>
        ) : (
          <>
            <Copy data-icon="inline-start" />
            Copy link
          </>
        )}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={shareOnX}
        className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
      >
        <Share2 data-icon="inline-start" />
        Share on X
      </Button>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
      >
        <a
          href={routes.publicReportImage(slug, scanId)}
          target="_blank"
          rel="noreferrer"
        >
          <Download data-icon="inline-start" />
          Share image
        </a>
      </Button>
    </div>
  );
}
