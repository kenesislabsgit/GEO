"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ActionStatusButtons({
  actionId,
  status,
}: {
  actionId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function setStatus(next: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/actions/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, status: next }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not update action");
      }
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update action",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex shrink-0 gap-2">
      {status !== "in_progress" && status !== "completed" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => setStatus("in_progress")}
        >
          Start
        </Button>
      ) : null}
      {status !== "completed" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => setStatus("completed")}
        >
          Mark done
        </Button>
      ) : null}
      {status !== "dismissed" && status !== "completed" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => setStatus("dismissed")}
        >
          Dismiss
        </Button>
      ) : null}
      {status === "completed" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => setStatus("open")}
        >
          Reopen
        </Button>
      ) : null}
    </div>
  );
}
