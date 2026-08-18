"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, TrendingDown, TrendingUp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Alert } from "@/types/database";

function alertIcon(type: string) {
  if (type.includes("drop")) return TrendingDown;
  if (type.includes("gain") || type.includes("improve")) return TrendingUp;
  if (type.includes("competitor")) return Users;
  return Bell;
}

export function AlertList({ alerts }: { alerts: Alert[] }) {
  const router = useRouter();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const unread = alerts.filter(
    (a) => !a.read_at && !readIds.has(a.id),
  ).length;

  async function markRead(alertId: string) {
    setReadIds((prev) => new Set(prev).add(alertId));
    await fetch(routes.api.alerts, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    }).catch(() => {});
    router.refresh();
  }

  async function markAll() {
    setReadIds(new Set(alerts.map((a) => a.id)));
    await fetch(routes.api.alerts, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    router.refresh();
  }

  if (alerts.length === 0) {
    return (
      <div className="arc-empty p-10 text-center">
        <Bell className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-3 font-medium">No alerts yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Scheduled monitoring creates alerts when your score moves, a
          competitor appears or drops out, a cited source appears or
          disappears, your mentions stop, or a scan fails.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unread > 0 ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => void markAll()}>
            <Check data-icon="inline-start" />
            Mark all read
          </Button>
        </div>
      ) : null}
      <div className="arc-list">
        <div className="divide-y divide-border">
          {alerts.map((alert) => {
            const Icon = alertIcon(alert.type);
            const isRead = Boolean(alert.read_at) || readIds.has(alert.id);
            return (
              <div
                key={alert.id}
                className={cn(
                  "flex gap-4 px-5 py-4",
                  isRead ? "bg-card" : "bg-[color:var(--arc-accent-soft)]/40",
                )}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{alert.title}</p>
                    <Badge
                      variant="secondary"
                      className="rounded-full text-[11px] capitalize"
                    >
                      {alert.type.replaceAll("_", " ")}
                    </Badge>
                    {!isRead ? (
                      <span
                        aria-label="Unread"
                        className="size-2 rounded-full bg-[color:var(--arc-accent)]"
                      />
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{alert.body}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{new Date(alert.created_at).toLocaleString()}</span>
                    {alert.brand_id ? (
                      <Link
                        href={routes.brand(alert.brand_id)}
                        className="underline hover:text-foreground"
                      >
                        View website
                      </Link>
                    ) : null}
                    {!isRead ? (
                      <button
                        type="button"
                        onClick={() => void markRead(alert.id)}
                        className="underline hover:text-foreground"
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
