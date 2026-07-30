import { NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import {
  usingLocalDb,
  claimOrCopyBrand,
  getBrandBySlug,
  listBrandsForOwner,
} from "@/lib/db/repository";
import { createClient } from "@/lib/db/supabase/server";
import { routes, safeReturnTo } from "@/lib/routes";

const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter a password."),
  mode: z.enum(["signin", "signup"]),
  claim: z.string().optional().nullable(),
  returnTo: z.string().optional().nullable(),
});

type AuthBody = z.infer<typeof schema>;

async function parseBody(request: Request) {
  const isJson =
    request.headers.get("content-type")?.includes("application/json") ?? false;
  const raw = isJson
    ? await request.json().catch(() => null)
    : Object.fromEntries(await request.formData().catch(() => new FormData()));
  return { isJson, parsed: schema.safeParse(raw) };
}

function errorResponse(
  request: Request,
  isJson: boolean,
  message: string,
  mode?: string,
) {
  if (isJson) return NextResponse.json({ error: message }, { status: 400 });
  const url = new URL("/login", request.url);
  url.searchParams.set("mode", mode === "signup" ? "signup" : "signin");
  url.searchParams.set("error", message);
  return NextResponse.redirect(url, 303);
}

function successResponse(request: Request, isJson: boolean, redirect: string) {
  return isJson
    ? NextResponse.json({ redirect })
    : NextResponse.redirect(new URL(redirect, request.url), 303);
}

async function resolveRedirect(input: {
  userId: string;
  claim: string | null | undefined;
  returnTo: string | null | undefined;
}): Promise<string> {
  if (input.claim) {
    return `${routes.brands}?claimed=${encodeURIComponent(input.claim)}`;
  }
  const returnTo = safeReturnTo(input.returnTo);
  if (returnTo) return returnTo;

  const brands = await listBrandsForOwner(input.userId);
  // New accounts with nothing to show yet go straight into the signed-in
  // scan flow — never the public homepage hero.
  if (brands.length === 0) return routes.newScan();
  return routes.dashboard;
}

export async function POST(request: Request) {
  const { isJson, parsed } = await parseBody(request);
  if (!parsed.success) {
    const error = parsed.error.issues[0]?.message || "Enter a valid email and password.";
    return errorResponse(request, isJson, error);
  }
  const body: AuthBody = parsed.data;

  if (!usingLocalDb()) {
    const supabase = await createClient();
    if (body.mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: body.email,
        password: body.password,
      });
      if (error) {
        return errorResponse(request, isJson, error.message, body.mode);
      }
      if (body.claim && data.user) {
        const brand = await getBrandBySlug(body.claim);
        if (brand) await claimOrCopyBrand(brand.id, data.user.id);
      }
      const redirect = data.user
        ? await resolveRedirect({
            userId: data.user.id,
            claim: body.claim,
            returnTo: body.returnTo,
          })
        : routes.dashboard;
      return successResponse(request, isJson, redirect);
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (error) {
      return errorResponse(request, isJson, error.message, body.mode);
    }
    const redirect = data.user
      ? await resolveRedirect({
          userId: data.user.id,
          claim: body.claim,
          returnTo: body.returnTo,
        })
      : routes.dashboard;
    return successResponse(request, isJson, redirect);
  }

  // Local demo auth for environments without Supabase.
  const id = createHash("sha256").update(body.email.toLowerCase()).digest("hex").slice(0, 32);
  const user = {
    id: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`,
    email: body.email.toLowerCase(),
  };

  // Ensure UUID-looking id
  if (user.id.length !== 36) {
    user.id = randomUUID();
  }

  if (body.claim) {
    const brand = await getBrandBySlug(body.claim);
    if (brand) await claimOrCopyBrand(brand.id, user.id);
  }

  const redirect = await resolveRedirect({
    userId: user.id,
    claim: body.claim,
    returnTo: body.returnTo,
  });
  const response = successResponse(request, isJson, redirect);
  response.cookies.set("rbai_local_user", encodeURIComponent(JSON.stringify(user)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
