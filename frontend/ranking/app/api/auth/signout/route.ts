import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";

export async function POST(request: Request) {
  // Revoke the Better Auth session if there is one. A request without a
  // session just throws, which is fine - there was nothing to revoke.
  await auth.api.signOut({ headers: request.headers }).catch(() => {});
  return NextResponse.redirect(new URL("/", request.url), 303);
}
