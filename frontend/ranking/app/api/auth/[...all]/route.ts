import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/auth";

// Sign-in, sign-up, sign-out, the Google redirect and its callback all live
// under /api/auth/*. The /api/auth/signout and /api/auth/complete routes sit
// at fixed paths, so they win over this catch-all.
export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth.handler);
