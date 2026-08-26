import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER } from "@/lib/auth/redirects";

const ROOT_DOMAIN = "arcanoris.in";
const APP_DOMAIN = `app.${ROOT_DOMAIN}`;

function isProductionDomain(hostname: string) {
  return hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`);
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hostname =
    request.headers.get("host")?.split(":")[0] ?? request.nextUrl.hostname;
  const isProtected =
    pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  const requestHeaders = new Headers(request.headers);
  if (isProtected) {
    requestHeaders.set(REQUEST_PATH_HEADER, `${pathname}${search}`);
  }

  if (isProtected && isProductionDomain(hostname)) {
    const dashboardUrl = new URL(`https://${APP_DOMAIN}`);
    if (hostname !== APP_DOMAIN) {
      dashboardUrl.pathname = pathname;
      dashboardUrl.search = search;
      return NextResponse.redirect(dashboardUrl);
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*", "/admin", "/admin/:path*"],
};
