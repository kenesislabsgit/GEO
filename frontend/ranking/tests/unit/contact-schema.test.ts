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
    expect(contactInquirySchema.safeParse({ ...valid, phone: "" }).success).toBe(
      true,
    );
    expect(
      contactInquirySchema.safeParse({ ...valid, phone: "call me" }).success,
    ).toBe(false);
  });
});
