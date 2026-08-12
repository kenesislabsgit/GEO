import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url), 303);

  // Revoke the Better Auth session if there is one. A request without a
  // session just throws, which is fine — there was nothing to revoke.
  await auth.api.signOut({ headers: request.headers }).catch(() => {});

  // Clears the cookie the old fake login used to set, so anyone still
  // carrying one is signed out for good.
  response.cookies.set("rbai_local_user", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
