"use client";

import { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportDeleteForms() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);

  async function exportData() {
    setBusy("export");
    setMessage(null);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "arcanoris-export.json";
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Export downloaded.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    // Explicit typed confirmation, matched again on the server. A misclick
    // through a yes/no dialog must not be able to erase an account.
    const typed = prompt(
      'Deleting your account cancels running audits and your subscription, and permanently removes your data. Type "DELETE" to confirm.',
    );
    if (typed !== "DELETE") return;
    setBusy("delete");
    setMessage(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      window.location.assign("/");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  return (
    <div className="arc-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-sm font-medium">Export your data</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Download your account and the audit data included in your plan.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportData}
          disabled={busy !== null}
        >
          {busy === "export" ? (
            <>
              <Loader2 data-icon="inline-start" className="animate-spin" />
              Exporting…
            </>
          ) : (
            <>
              <Download data-icon="inline-start" />
              Export data
            </>
          )}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-destructive">
            Delete account
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Permanently removes your account and owned brand data.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={deleteAccount}
          disabled={busy !== null}
        >
          {busy === "delete" ? (
            <>
              <Loader2 data-icon="inline-start" className="animate-spin" />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 data-icon="inline-start" />
              Delete account
            </>
          )}
        </Button>
      </div>
      {message ? (
        <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
