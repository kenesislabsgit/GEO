import { z } from "zod";

export const COMPANY_SIZES = [
  { id: "1-10", label: "1–10 people" },
  { id: "11-50", label: "11–50 people" },
  { id: "51-200", label: "51–200 people" },
  { id: "201-1000", label: "201–1,000 people" },
  { id: "1000+", label: "1,000+ people" },
  { id: "agency", label: "Agency or consultancy" },
] as const;

export const CONTACT_INTERESTS = [
  { id: "pro", label: "Pro plan" },
  { id: "plus", label: "Plus plan" },
  { id: "growth", label: "Growth waitlist" },
  { id: "multiple-sites", label: "Monitoring more than one website" },
  { id: "custom", label: "Custom limits or providers" },
  { id: "support", label: "Account or billing support" },
  { id: "other", label: "Something else" },
] as const;

export type CompanySizeId = (typeof COMPANY_SIZES)[number]["id"];
export type ContactInterestId = (typeof CONTACT_INTERESTS)[number]["id"];

const phonePattern = /^[+0-9().\-\s]{7,40}$/;

const inquiryFields = z.object({
  companySize: z
    .enum(["", "1-10", "11-50", "51-200", "201-1000", "1000+", "agency"], {
      error: "Please select a company size.",
    })
    .default(""),
  companyName: z.string().trim().max(120).default(""),
  firstName: z.string().trim().max(60).default(""),
  lastName: z.string().trim().max(60).default(""),
  workEmail: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .max(254)
    .email("Enter a valid email."),
  phone: z.string().trim().max(40).default(""),
  website: z.string().trim().max(200).default(""),
  interest: z.enum(
    ["pro", "plus", "growth", "multiple-sites", "custom", "support", "other"],
    { error: "Please select what you are interested in." },
  ),
  needs: z.string().trim().max(4000).default(""),
  hp: z.string().max(200).optional(),
});

export function isSalesInquiry(interest: ContactInterestId) {
  return interest !== "support" && interest !== "other";
}

export const contactInquirySchema = z
  .preprocess((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return input;
    const value = input as Record<string, unknown>;
    if (value.interest !== "support" && value.interest !== "other")
      return input;
    // Switching to support must discard hidden sales fields before validation.
    return {
      ...value,
      companySize: "",
      companyName: "",
      lastName: "",
      phone: "",
      website: "",
    };
  }, inquiryFields)
  .superRefine((value, ctx) => {
    if (!isSalesInquiry(value.interest)) {
      if (value.needs.length < 10)
        ctx.addIssue({
          code: "custom",
          path: ["needs"],
          message: "Describe your request in at least 10 characters.",
        });
      return;
    }
    for (const field of [
      "companySize",
      "companyName",
      "firstName",
      "lastName",
      "website",
    ] as const) {
      if (!value[field])
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "This field is required for a sales inquiry.",
        });
    }
    if (value.phone && !phonePattern.test(value.phone))
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Enter a valid phone number.",
      });
  });

export type ContactInquiry = z.infer<typeof contactInquirySchema>;

export function labelForCompanySize(id: CompanySizeId | ""): string {
  return COMPANY_SIZES.find((item) => item.id === id)?.label ?? id;
}

export function labelForInterest(id: ContactInterestId): string {
  return CONTACT_INTERESTS.find((item) => item.id === id)?.label ?? id;
}

export function isContactIntent(
  value: string | undefined,
): value is ContactInterestId {
  return CONTACT_INTERESTS.some((item) => item.id === value);
}
