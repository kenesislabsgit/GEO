import { describe, expect, it } from "vitest";
import { contactInquirySchema } from "@/lib/contact/schema";

const valid = {
  companySize: "11-50",
  companyName: "Kenesis",
  firstName: "Ada",
  lastName: "Lovelace",
  workEmail: "ada@kenesis.ai",
  phone: "",
  website: "kenesis.ai",
  interest: "pro",
  needs: "Need 8 brands measured weekly.",
};

describe("contactInquirySchema", () => {
  it("accepts support with only an email and meaningful issue description", () => {
    const parsed = contactInquirySchema.safeParse({
      interest: "support",
      workEmail: "buyer@example.com",
      needs: "Please help locate a duplicate charge.",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.website).toBe("");
  });

  it("requires a support description and drops business details when switching from sales", () => {
    expect(
      contactInquirySchema.safeParse({
        ...valid,
        interest: "support",
        needs: "",
      }).success,
    ).toBe(false);
    const support = contactInquirySchema.parse({
      ...valid,
      interest: "support",
      phone: "invalid old sales input",
      companySize: "invalid old selection",
      website: "x".repeat(300),
    });
    expect(support.companyName).toBe("");
    expect(support.website).toBe("");
    expect(support.phone).toBe("");
    expect(support.needs).toBe(valid.needs);
  });
  it("accepts a complete Pro inquiry", () => {
    const parsed = contactInquirySchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing website and a bad email", () => {
    expect(
      contactInquirySchema.safeParse({ ...valid, website: "" }).success,
    ).toBe(false);
    expect(
      contactInquirySchema.safeParse({ ...valid, workEmail: "not-an-email" })
        .success,
    ).toBe(false);
  });

  it("allows a blank phone and rejects garbage", () => {
    expect(
      contactInquirySchema.safeParse({ ...valid, phone: "" }).success,
    ).toBe(true);
    expect(
      contactInquirySchema.safeParse({ ...valid, phone: "call me" }).success,
    ).toBe(false);
  });
});
