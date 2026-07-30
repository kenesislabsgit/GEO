"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import type { Competitor } from "@/types/database";

export function CompetitorsManager({
  brandId,
  initialCompetitors,
  competitorLimit,
  isPaid,
}: {
  brandId: string;
  initialCompetitors: Competitor[];
  competitorLimit: number;
  isPaid: boolean;
}) {
  const [competitors, setCompetitors] = useState(initialCompetitors);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addCompetitor() {
    if (!name.trim()) {
      toast.error("Enter a competitor name.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          name: name.trim(),
          domain: domain.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add competitor");
      setCompetitors((prev) => [...prev, data.competitor as Competitor]);
      setName("");
      setDomain("");
      setShowAdd(false);
      toast.success("Competitor added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add competitor");
    } finally {
      setBusy(false);
    }
  }

  async function removeCompetitor(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/competitors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, competitorId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove competitor");
      setCompetitors((prev) => prev.filter((c) => c.id !== id));
      setDeleteId(null);
      toast.success("Competitor removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove competitor");
    } finally {
      setBusy(false);
    }
  }

  if (!isPaid) {
    return (
      <div className="rb-empty p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Upgrade to add, remove, and compare competitors across scans.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {competitors.length} of {competitorLimit} competitors tracked
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={competitors.length >= competitorLimit || busy}
          onClick={() => setShowAdd(true)}
        >
          <Plus data-icon="inline-start" />
          Add competitor
        </Button>
      </div>

      {competitors.length === 0 ? (
        <div className="rb-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No competitors yet. Add competitors you want to track, or run a scan
            to discover who AI recommends in your category.
          </p>
        </div>
      ) : (
        <div className="rb-list">
          <div className="divide-y divide-border">
            {competitors.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-4 bg-card px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium capitalize">
                    {c.name}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {c.domain && c.domain.toLowerCase() !== "unknown"
                      ? c.domain
                      : "No verified domain"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDeleteId(c.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add competitor</DialogTitle>
            <DialogDescription>
              Track a brand that AI engines recommend alongside yours.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Competitor name"
              />
            </Field>
            <Field>
              <FieldLabel>Domain (optional)</FieldLabel>
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="competitor.com"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={addCompetitor}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteId)} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove competitor?</DialogTitle>
            <DialogDescription>
              This removes the competitor from tracking. Past scan history is
              preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => deleteId && removeCompetitor(deleteId)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
