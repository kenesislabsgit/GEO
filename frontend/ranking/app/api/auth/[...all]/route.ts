import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/auth";

// Sign-in, sign-up, sign-out, the Google redirect and its callback all live
// under /api/auth/*. The existing /api/auth/local and /api/auth/signout routes
// sit at fixed paths, so they still win over this catch-all and the local
// test login keeps working.
export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth.handler);
