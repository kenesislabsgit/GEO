"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

/**
 * The operational controls, wired to /api/admin/actions. Every action
 * requires its own confirmation and lands in the admin audit log.
 */
export function AdminControls() {
  const [maintenance, setMaintenance] = useState(false);
  const [disabled, setDisabled] = useState<string>("");
  const [scanId, setScanId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/actions");
      if (!res.ok) return;
      const data = (await res.json()) as {
        maintenance: boolean;
        disabledProviders: string[];
      };
      setMaintenance(data.maintenance);
      setDisabled(data.disabledProviders.join(", "));
      setLoaded(true);
    })();
  }, []);

  async function act(payload: Record<string, unknown>, label: string) {
    if (!confirm(`${label} - are you sure?`)) return;
    setBusy(label);
    try {
      const res = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      toast.success(`${label}: done`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) {
    return (
      <div className="rb-panel mt-10 flex items-center gap-2 p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading controls…
      </div>
    );
  }

  return (
    <div className="rb-panel mt-10 space-y-5 p-6">
      <h2 className="font-semibold tracking-tight">Operational controls</h2>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Maintenance mode</p>
          <p className="text-xs text-muted-foreground">
            Refuses all new audits (manual and scheduled) until switched off.
          </p>
        </div>
        <Switch
          checked={maintenance}
          disabled={busy !== null}
          onCheckedChange={(enabled) => {
            void act(
              { action: "set_maintenance", enabled },
              enabled ? "Enable maintenance mode" : "Disable maintenance mode",
            ).then(() => setMaintenance(enabled));
          }}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Disabled providers</p>
        <p className="text-xs text-muted-foreground">
          Comma-separated provider ids (e.g. openai_search, gemini). Disabled
          providers are stripped from every new scan.
        </p>
        <div className="flex gap-2">
          <Input
            value={disabled}
            onChange={(e) => setDisabled(e.target.value)}
            placeholder="none disabled"
            className="max-w-md"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              act(
                {
                  action: "set_disabled_providers",
                  providers: disabled
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                },
                "Update disabled providers",
              )
            }
          >
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Scan controls</p>
        <div className="flex flex-wrap gap-2">
          <Input
            value={scanId}
            onChange={(e) => setScanId(e.target.value)}
            placeholder="scan id"
            className="max-w-sm font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !scanId}
            onClick={() =>
              act({ action: "retry_scan", scanId: scanId.trim() }, "Retry scan")
            }
          >
            Retry
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy !== null || !scanId}
            onClick={() =>
              act(
                { action: "cancel_scan", scanId: scanId.trim() },
                "Cancel scan",
              )
            }
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
