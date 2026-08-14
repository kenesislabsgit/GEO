import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export default async function proxy(request: NextRequest) {
  // Presence only, deliberately. This runs on every protected request and
  // cannot reach the database, so it is a cheap gate to keep signed-out people
  // off the page — never the authorisation check. Every page still calls
  // getSessionUser(), which validates the session properly and is what decides
  // whose data gets loaded. Reading the cookie through better-auth's own
  // helper rather than by name keeps the secure- prefix used in production
  // from silently failing this check.
  //
  // Better Auth is the only login. The Supabase fallback that used to sit
  // here was a second, env-var-activated way to be "authenticated" — gone
  // with the rest of the Supabase era.
  const authenticated = Boolean(getSessionCookie(request));

  const { pathname, search } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  if (isProtected && !authenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: request.headers } });
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
