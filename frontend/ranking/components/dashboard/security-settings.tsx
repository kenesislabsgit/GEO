"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { routes } from "@/lib/routes";

const EMAIL_UPDATED_PARAM = "email";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SessionRow = {
  token: string;
  createdAt: string;
  userAgent: string | null;
  current: boolean;
};

export function SecuritySettings({
  name,
  email,
  emailVerified,
  hasPassword,
  hasGoogle,
  sessions,
}: {
  name: string;
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  sessions: SessionRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailJustUpdated = searchParams.get(EMAIL_UPDATED_PARAM) === "updated";

  const [displayName, setDisplayName] = useState(name);
  const [savingName, setSavingName] = useState(false);
  const [nameNote, setNameNote] = useState<string | null>(null);

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);

  const [resendBusy, setResendBusy] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState<string | null>(null);

  const [revoking, setRevoking] = useState<string | null>(null);

  async function saveName() {
    setSavingName(true);
    setNameNote(null);
    const res = await authClient.updateUser({ name: displayName.trim() });
    setNameNote(res.error ? "Could not save the name." : "Saved.");
    setSavingName(false);
    router.refresh();
  }

  async function changeEmail() {
    const trimmed = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setEmailNote("Enter a valid email address.");
      return;
    }
    if (trimmed === email.toLowerCase()) {
      setEmailNote("That's already your email.");
      return;
    }
    setEmailBusy(true);
    setEmailNote(null);
    const res = await authClient.changeEmail({
      newEmail: trimmed,
      callbackURL: `${routes.settings}?${EMAIL_UPDATED_PARAM}=updated`,
    });
    if (res.error) {
      setEmailNote(res.error.message || "Could not start the change.");
    } else if (emailVerified) {
      setEmailNote(
        `Confirmation link sent to ${email} - click it to move the account to ${trimmed}.`,
      );
    } else {
      setEmailNote(
        `Address updated. We sent a verification link to ${trimmed} - click it to confirm.`,
      );
      router.refresh();
    }
    setEmailBusy(false);
  }

  async function resendVerification() {
    setResendBusy(true);
    setResendNote(null);
    const res = await authClient.sendVerificationEmail({
      email,
      callbackURL: `${routes.verifyEmail}?verified=1`,
    });
    setResendNote(
      res.error ? "Could not send it - try again shortly." : "Sent - check your inbox.",
    );
    setResendBusy(false);
  }

  async function changePassword() {
    if (newPw.length < 8) {
      setPwNote("New password needs at least 8 characters.");
      return;
    }
    setPwBusy(true);
    setPwNote(null);
    const res = await authClient.changePassword({
      currentPassword: currentPw,
      newPassword: newPw,
      revokeOtherSessions: true,
    });
    if (res.error) {
      setPwNote(res.error.message || "Could not change the password.");
    } else {
      setPwNote("Password changed. Other sessions were signed out.");
      setCurrentPw("");
      setNewPw("");
    }
    setPwBusy(false);
  }

  async function revoke(token: string) {
    setRevoking(token);
    await authClient.revokeSession({ token }).catch(() => {});
    setRevoking(null);
    router.refresh();
  }

  async function revokeOthers() {
    setRevoking("others");
    await authClient.revokeOtherSessions().catch(() => {});
    setRevoking(null);
    router.refresh();
  }

  return (
    <>
      {/* ── Profile ── */}
      <div className="arc-panel">
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-semibold">Account</p>
        </div>
        <div className="space-y-4 px-5 py-4">
          {emailJustUpdated ? (
            <p className="rounded-lg bg-[color:var(--arc-accent-soft)] px-3 py-2 text-sm text-[color:var(--arc-accent)]">
              Email confirmed.
            </p>
          ) : null}
          <div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Email</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="w-fit rounded-full">
                  {emailVerified ? "Verified" : "Not verified"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowEmailForm((v) => !v);
                    setEmailNote(null);
                  }}
                >
                  {showEmailForm ? "Cancel" : "Change"}
                </Button>
              </div>
            </div>
            {!emailVerified ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => void resendVerification()}
                  disabled={resendBusy}
                  className="font-medium text-[color:var(--arc-accent)] hover:underline disabled:opacity-60"
                >
                  {resendBusy ? "Sending…" : "Resend verification email"}
                </button>
                {resendNote ? ` - ${resendNote}` : null}
              </p>
            ) : null}
            {showEmailForm ? (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void changeEmail();
                }}
              >
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="new@address.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="max-w-xs"
                  required
                />
                <Button type="submit" variant="outline" disabled={emailBusy || !newEmail}>
                  {emailBusy ? <Loader2 className="animate-spin" /> : "Send confirmation"}
                </Button>
              </form>
            ) : null}
            {emailNote ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{emailNote}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="display-name" className="text-sm font-medium">
              Display name
            </label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="outline"
                onClick={() => void saveName()}
                disabled={savingName || displayName.trim() === name}
              >
                {savingName ? <Loader2 className="animate-spin" /> : "Save"}
              </Button>
            </div>
            {nameNote ? (
              <p className="mt-1 text-xs text-muted-foreground">{nameNote}</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium">Sign-in methods</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                How you get into this account.
              </p>
            </div>
            <div className="flex gap-1.5">
              {hasPassword ? (
                <Badge variant="secondary" className="rounded-full">Password</Badge>
              ) : null}
              {hasGoogle ? (
                <Badge variant="secondary" className="rounded-full">Google</Badge>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ── Password ── */}
      {hasPassword ? (
        <div className="arc-panel">
          <div className="border-b border-border px-5 py-4">
            <p className="text-sm font-semibold">Change password</p>
          </div>
          <form
            className="space-y-3 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 sm:max-w-lg">
              <div>
                <label htmlFor="current-pw" className="text-sm font-medium">
                  Current password
                </label>
                <Input
                  id="current-pw"
                  type="password"
                  autoComplete="current-password"
                  className="mt-1.5"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="new-pw" className="text-sm font-medium">
                  New password
                </label>
                <Input
                  id="new-pw"
                  type="password"
                  autoComplete="new-password"
                  className="mt-1.5"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  required
                />
              </div>
            </div>
            {pwNote ? (
              <p className="text-xs text-muted-foreground">{pwNote}</p>
            ) : null}
            <Button type="submit" disabled={pwBusy || !currentPw || !newPw}>
              {pwBusy ? (
                <>
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                  Changing…
                </>
              ) : (
                "Change password"
              )}
            </Button>
          </form>
        </div>
      ) : (
        <div className="arc-panel px-5 py-4">
          <p className="text-sm font-medium">Password</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            This account signs in with Google only, so there is no password to
            change. Use &ldquo;Forgot password&rdquo; on the sign-in page if
            you ever want to add one.
          </p>
        </div>
      )}

      {/* ── Sessions ── */}
      <div className="arc-panel">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <p className="text-sm font-semibold">Active sessions</p>
          {sessions.length > 1 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void revokeOthers()}
              disabled={revoking !== null}
            >
              Sign out other sessions
            </Button>
          ) : null}
        </div>
        <div className="divide-y divide-border">
          {sessions.map((s) => (
            <div
              key={s.token}
              className="flex items-center justify-between px-5 py-3.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {describeAgent(s.userAgent)}
                  {s.current ? (
                    <Badge variant="secondary" className="ml-2 rounded-full text-[11px]">
                      This device
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Signed in {new Date(s.createdAt).toLocaleString()}
                </p>
              </div>
              {!s.current ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void revoke(s.token)}
                  disabled={revoking !== null}
                >
                  {revoking === s.token ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    "Revoke"
                  )}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function describeAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = userAgent.includes("Firefox")
    ? "Firefox"
    : userAgent.includes("Edg")
      ? "Edge"
      : userAgent.includes("Chrome")
        ? "Chrome"
        : userAgent.includes("Safari")
          ? "Safari"
          : "Browser";
  const os = userAgent.includes("Windows")
    ? "Windows"
    : userAgent.includes("Mac")
      ? "macOS"
      : userAgent.includes("Linux")
        ? "Linux"
        : userAgent.includes("Android")
          ? "Android"
          : userAgent.includes("iPhone") || userAgent.includes("iOS")
            ? "iOS"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
