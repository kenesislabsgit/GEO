import { NextResponse, type NextRequest } from "next/server";

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

  if (isProtected && isProductionDomain(hostname)) {
    const dashboardUrl = new URL(`https://${APP_DOMAIN}`);
    if (hostname !== APP_DOMAIN) {
      dashboardUrl.pathname = pathname;
      dashboardUrl.search = search;
      return NextResponse.redirect(dashboardUrl);
    }
  }

  return NextResponse.next({ request: { headers: request.headers } });
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
