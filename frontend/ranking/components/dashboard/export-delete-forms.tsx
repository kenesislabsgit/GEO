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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rankedbyai-export.json";
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
    if (!confirm("Delete your account and owned brand data? This cannot be undone.")) {
      return;
    }
    setBusy("delete");
    setMessage(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      window.location.assign("/");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  return (
    <div className="rb-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-sm font-medium">Export your data</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Download all brands, scans, and scores as JSON.
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
