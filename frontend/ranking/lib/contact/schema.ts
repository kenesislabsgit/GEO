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

export const contactInquirySchema = z.object({
  companySize: z.enum(
    ["1-10", "11-50", "51-200", "201-1000", "1000+", "agency"],
    { error: "Please select a company size." },
  ),
  companyName: z.string().trim().min(1, "Company name is required.").max(120),
  firstName: z.string().trim().min(1, "First name is required.").max(60),
  lastName: z.string().trim().min(1, "Last name is required.").max(60),
  workEmail: z
    .string()
    .trim()
    .min(1, "Work email is required.")
    .max(254)
    .email("Enter a valid work email."),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((value) => value === "" || phonePattern.test(value), {
      message: "Enter a valid phone number.",
    }),
  website: z.string().trim().min(3, "Website is required.").max(200),
  interest: z.enum(
    ["pro", "plus", "growth", "multiple-sites", "custom", "support", "other"],
    { error: "Please select what you are interested in." },
  ),
  needs: z.string().trim().max(4000),
  hp: z.string().max(200).optional(),
});

export type ContactInquiry = z.infer<typeof contactInquirySchema>;

export function labelForCompanySize(id: CompanySizeId): string {
  return COMPANY_SIZES.find((item) => item.id === id)?.label ?? id;
}

export function labelForInterest(id: ContactInterestId): string {
  return CONTACT_INTERESTS.find((item) => item.id === id)?.label ?? id;
}

export function isContactIntent(value: string | undefined): value is ContactInterestId {
  return CONTACT_INTERESTS.some((item) => item.id === value);
}
