"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMPANY_SIZES,
  CONTACT_INTERESTS,
  contactInquirySchema,
  type ContactInquiry,
  type CompanySizeId,
  type ContactInterestId,
} from "@/lib/contact/schema";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { routes } from "@/lib/routes";

type FormState = Omit<ContactInquiry, "companySize"> & {
  companySize: ContactInquiry["companySize"] | "";
};

const EMPTY: FormState = {
  companySize: "",
  companyName: "",
  firstName: "",
  lastName: "",
  workEmail: "",
  phone: "",
  website: "",
  interest: "pro",
  needs: "",
  hp: "",
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

export function ContactForm({
  defaultEmail = "",
  defaultInterest = "pro",
}: {
  defaultEmail?: string;
  defaultInterest?: ContactInterestId;
}) {
  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    workEmail: defaultEmail,
    interest: defaultInterest,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = contactInquirySchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !next[key as keyof FormState]) {
          next[key as keyof FormState] = issue.message;
        }
      }
      setErrors(next);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setDone(true);
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          We got it.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Thanks. We typically reply within one business day. If it is urgent,
          email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-foreground underline underline-offset-4"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="relative rounded-2xl border border-border bg-card p-6 shadow-[0_24px_64px_-32px_rgba(0,0,0,0.35)] md:p-8"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="companySize">
            Company size <span className="text-destructive">*</span>
          </Label>
          <Select
            value={form.companySize || undefined}
            onValueChange={(value) => setField("companySize", value as CompanySizeId)}
          >
            <SelectTrigger
              id="companySize"
              className="mt-1.5 h-9 w-full rounded-xl"
              aria-invalid={Boolean(errors.companySize)}
            >
              <SelectValue placeholder="Please select" />
            </SelectTrigger>
            <SelectContent>
              {COMPANY_SIZES.map((size) => (
                <SelectItem key={size.id} value={size.id}>
                  {size.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.companySize} />
        </div>
        <div>
          <Label htmlFor="companyName">
            Company name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="companyName"
            className="mt-1.5"
            autoComplete="organization"
            value={form.companyName}
            onChange={(event) => setField("companyName", event.target.value)}
            aria-invalid={Boolean(errors.companyName)}
          />
          <FieldError message={errors.companyName} />
        </div>
        <div>
          <Label htmlFor="firstName">
            First name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="firstName"
            className="mt-1.5"
            autoComplete="given-name"
            value={form.firstName}
            onChange={(event) => setField("firstName", event.target.value)}
            aria-invalid={Boolean(errors.firstName)}
          />
          <FieldError message={errors.firstName} />
        </div>
        <div>
          <Label htmlFor="lastName">
            Last name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="lastName"
            className="mt-1.5"
            autoComplete="family-name"
            value={form.lastName}
            onChange={(event) => setField("lastName", event.target.value)}
            aria-invalid={Boolean(errors.lastName)}
          />
          <FieldError message={errors.lastName} />
        </div>
        <div>
          <Label htmlFor="workEmail">
            Work email <span className="text-destructive">*</span>
          </Label>
          <Input
            id="workEmail"
            type="email"
            className="mt-1.5"
            autoComplete="email"
            value={form.workEmail}
            onChange={(event) => setField("workEmail", event.target.value)}
            aria-invalid={Boolean(errors.workEmail)}
          />
          <FieldError message={errors.workEmail} />
        </div>
        <div>
          <Label htmlFor="phone">Phone number</Label>
          <Input
            id="phone"
            type="tel"
            className="mt-1.5"
            autoComplete="tel"
            value={form.phone}
            onChange={(event) => setField("phone", event.target.value)}
            aria-invalid={Boolean(errors.phone)}
          />
          <FieldError message={errors.phone} />
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="website">
          Company website <span className="text-destructive">*</span>
        </Label>
        <Input
          id="website"
          className="mt-1.5"
          inputMode="url"
          autoComplete="url"
          placeholder="yourcompany.com"
          value={form.website}
          onChange={(event) => setField("website", event.target.value)}
          aria-invalid={Boolean(errors.website)}
        />
        <FieldError message={errors.website} />
      </div>

      <div className="mt-4">
        <Label htmlFor="interest">
          What are you interested in? <span className="text-destructive">*</span>
        </Label>
        <Select
          value={form.interest}
          onValueChange={(value) =>
            setField("interest", value as ContactInterestId)
          }
        >
          <SelectTrigger
            id="interest"
            className="mt-1.5 h-9 w-full rounded-xl"
            aria-invalid={Boolean(errors.interest)}
          >
            <SelectValue placeholder="Select one" />
          </SelectTrigger>
          <SelectContent>
            {CONTACT_INTERESTS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={errors.interest} />
      </div>

      <div className="mt-4">
        <Label htmlFor="needs">
          What do you need help measuring or fixing?
        </Label>
        <Textarea
          id="needs"
          className="mt-1.5 min-h-28"
          value={form.needs}
          onChange={(event) => setField("needs", event.target.value)}
          aria-invalid={Boolean(errors.needs)}
        />
        <FieldError message={errors.needs} />
      </div>

      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
        <Label htmlFor="hp">Company</Label>
        <Input
          id="hp"
          tabIndex={-1}
          autoComplete="off"
          value={form.hp ?? ""}
          onChange={(event) => setField("hp", event.target.value)}
        />
      </div>

      {formError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}

      <Button type="submit" className="mt-6 h-10 w-full" disabled={busy}>
        {busy ? (
          <>
            <Loader2 data-icon="inline-start" className="animate-spin" />
            Sending…
          </>
        ) : (
          "Submit"
        )}
      </Button>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        For other inquiries, email{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="underline underline-offset-4 hover:text-foreground"
        >
          {SUPPORT_EMAIL}
        </a>{" "}
        or read the{" "}
        <Link href={routes.methodology} className="underline underline-offset-4 hover:text-foreground">
          methodology
        </Link>
        .
      </p>
    </form>
  );
}
