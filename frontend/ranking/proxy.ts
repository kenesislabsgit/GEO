import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSessionCookie } from "better-auth/cookies";

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseConfigured = Boolean(url && key);

  // Presence only, deliberately. This runs on every protected request and
  // cannot reach the database, so it is a cheap gate to keep signed-out people
  // off the page — never the authorisation check. Every page still calls
  // getSessionUser(), which validates the session properly and is what decides
  // whose data gets loaded. Reading the cookie through better-auth's own
  // helper rather than by name keeps the secure- prefix used in production
  // from silently failing this check.
  let authenticated = Boolean(getSessionCookie(request));

  if (!authenticated && supabaseConfigured) {
    const supabase = createServerClient(url!, key!, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    authenticated = Boolean(user);
  }

  const { pathname, search } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  if (isProtected && !authenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  // The login page checks the session itself, properly. Bouncing here on mere
  // cookie presence trapped anyone carrying a stale cookie in a loop: this
  // gate sent them to the dashboard, whose real check sent them back.

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/login",
  ],
};
