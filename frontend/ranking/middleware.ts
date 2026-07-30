import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function safePath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  return value;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseConfigured = Boolean(url && key);

  let authenticated = false;

  if (supabaseConfigured) {
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
  } else {
    // Local demo auth cookie set by /api/auth/local.
    authenticated = Boolean(request.cookies.get("rbai_local_user")?.value);
  }

  const { pathname, search } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  if (isProtected && !authenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && authenticated) {
    const claim = request.nextUrl.searchParams.get("claim");
    if (claim) {
      return NextResponse.redirect(
        new URL(`/claim/${encodeURIComponent(claim)}`, request.url),
      );
    }
    const returnTo = safePath(request.nextUrl.searchParams.get("returnTo"));
    return NextResponse.redirect(new URL(returnTo ?? "/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/login",
  ],
};
