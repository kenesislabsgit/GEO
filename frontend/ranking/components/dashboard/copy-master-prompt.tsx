"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Copies the audit's master prompt so the person can paste it straight into
 * an AI coding tool (Cursor, Claude Code, Windsurf…). The prompt is composed
 * on the server and arrives here as plain text.
 */
export function CopyMasterPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — your browser blocked clipboard access.");
    }
  }

  return (
    <Button onClick={copy} size="sm" variant={copied ? "outline" : "default"}>
      {copied ? (
        <>
          <Check className="size-3.5" aria-hidden /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden /> Copy AI prompt
        </>
      )}
    </Button>
  );
}
