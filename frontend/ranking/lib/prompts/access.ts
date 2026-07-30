import { getAccountEntitlements } from "@/lib/billing/account";
import {
  assertCanAddPrompt,
  EntitlementError,
} from "@/lib/billing/entitlements";
import { getBrandById } from "@/lib/db/repository";

export async function assertBrandOwnership(
  brandId: string,
  userId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getBrandById>>>> {
  const brand = await getBrandById(brandId);
  if (!brand || brand.owner_id !== userId) {
    throw new BrandAccessError("Brand not found");
  }
  return brand;
}

export class BrandAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandAccessError";
  }
}

export async function assertCanActivateAnotherPrompt(
  userId: string,
): Promise<void> {
  const entitlements = await getAccountEntitlements(userId);
  assertCanAddPrompt(entitlements);
}

export function isEntitlementError(error: unknown): error is EntitlementError {
  return error instanceof EntitlementError;
}

export function isBrandAccessError(error: unknown): error is BrandAccessError {
  return error instanceof BrandAccessError;
}
