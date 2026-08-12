"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser side of login. Talks to /api/auth/* on the same origin, so there is
 * no base URL to configure and nothing to keep in step when the domain changes.
 */
export const authClient = createAuthClient();

export const { signIn, signOut, signUp, useSession } = authClient;
