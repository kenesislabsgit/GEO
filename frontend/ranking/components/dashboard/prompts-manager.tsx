"use client";

import { useState } from "react";
import { Loader2, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  SUPPORTED_COUNTRIES,
  SUPPORTED_LANGUAGES,
} from "@/lib/constants";
import { routes } from "@/lib/routes";
import type { TrackedPrompt } from "@/types/database";

export function PromptsManager({
  brandId,
  initialPrompts,
  activePromptLimit,
  isPaid,
  defaultCountry,
  defaultLanguage,
}: {
  brandId: string;
  initialPrompts: TrackedPrompt[];
  activePromptLimit: number;
  isPaid: boolean;
  defaultCountry: string;
  defaultLanguage: string;
}) {
  const [prompts, setPrompts] = useState(initialPrompts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newCountry, setNewCountry] = useState(defaultCountry.toLowerCase());
  const [newLanguage, setNewLanguage] = useState(defaultLanguage.toLowerCase());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const activeCount = prompts.filter((p) => p.active).length;

  async function patchPrompt(
    id: string,
    patch: Partial<Pick<TrackedPrompt, "prompt" | "active">>,
  ) {
    setBusy(id);
    try {
      const res = await fetch(`${routes.api.prompts}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setPrompts((prev) =>
        prev.map((p) => (p.id === id ? (data.prompt as TrackedPrompt) : p)),
      );
      toast.success(patch.active === false ? "Prompt paused" : "Prompt updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function createPrompt() {
    if (!newPrompt.trim()) return;
    setBusy("create");
    try {
      const res = await fetch(routes.api.prompts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          prompt: newPrompt.trim(),
          country: newCountry,
          language: newLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add prompt");
      setPrompts((prev) => [data.prompt as TrackedPrompt, ...prev]);
      setNewPrompt("");
      setShowAdd(false);
      toast.success("Prompt added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add prompt");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setBusy(deleteId);
    try {
      const res = await fetch(`${routes.api.prompts}/${deleteId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setPrompts((prev) => prev.filter((p) => p.id !== deleteId));
      setDeleteId(null);
      toast.success("Prompt deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  function startEdit(prompt: TrackedPrompt) {
    setEditingId(prompt.id);
    setEditText(prompt.prompt);
  }

  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    await patchPrompt(id, { prompt: editText.trim() });
    setEditingId(null);
    setEditText("");
  }

  if (!isPaid) {
    return (
      <div className="rb-empty p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Upgrade to add, edit, and manage custom buyer questions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FieldDescription>
          {activeCount} of {activePromptLimit} active prompts across your account.
        </FieldDescription>
        <Button size="sm" onClick={() => setShowAdd(true)} disabled={busy !== null}>
          <Plus data-icon="inline-start" />
          Add prompt
        </Button>
      </div>

      {showAdd ? (
        <div className="rb-panel p-5">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-prompt">Buyer question</FieldLabel>
              <Textarea
                id="new-prompt"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                rows={3}
                placeholder="What are the best tools for…"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="new-country">Country</FieldLabel>
                <select
                  id="new-country"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                >
                  {SUPPORTED_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="new-language">Language</FieldLabel>
                <select
                  id="new-language"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={newLanguage}
                  onChange={(e) => setNewLanguage(e.target.value)}
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </FieldGroup>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              onClick={createPrompt}
              disabled={busy === "create" || !newPrompt.trim()}
            >
              {busy === "create" ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : null}
              Save prompt
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowAdd(false);
                setNewPrompt("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {prompts.length === 0 ? (
        <div className="rb-empty p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No prompts yet. Run a scan to generate them or add a custom question.
          </p>
        </div>
      ) : (
        <div className="rb-list">
          <div className="divide-y divide-border">
            {prompts.map((prompt) => (
              <div
                key={prompt.id}
                className="flex flex-col gap-3 bg-card px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  {editingId === prompt.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => saveEdit(prompt.id)}
                          disabled={busy === prompt.id}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium">{prompt.prompt}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {prompt.buyer_stage} · {prompt.country}/{prompt.language}
                      </p>
                    </>
                  )}
                </div>
                {editingId !== prompt.id ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge
                      variant={prompt.active ? "default" : "secondary"}
                      className="rounded-full text-[11px] capitalize"
                    >
                      {prompt.active ? "Active" : "Paused"}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="rounded-full text-[11px] capitalize"
                    >
                      {prompt.prompt_type.replaceAll("_", " ")}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(prompt)}
                      disabled={busy === prompt.id}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patchPrompt(prompt.id, { active: !prompt.active })
                      }
                      disabled={busy === prompt.id}
                    >
                      {prompt.active ? (
                        <>
                          <Pause data-icon="inline-start" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play data-icon="inline-start" />
                          Activate
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleteId(prompt.id)}
                      disabled={busy === prompt.id}
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete prompt?</DialogTitle>
            <DialogDescription>
              This buyer question will be removed from future scans. Existing scan
              results are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={busy !== null}
            >
              {busy ? <Loader2 className="animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
