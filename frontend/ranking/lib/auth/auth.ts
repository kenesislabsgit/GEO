import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";

/**
 * Login, owned by this application.
 *
 * The account you sign in with and the account rows the audits hang off used
 * to be issued by two different systems: Supabase minted the user id, and
 * every brand, scan and subscription referenced it. Moving the data anywhere
 * else meant carrying ids created by a service that no longer held them.
 * Better Auth writes the user row into our own database, so the id belongs to
 * us and the audit tables reference something we own.
 *
 * One database for everything. Accounts live in the same Postgres as the
 * brands, scans and subscriptions that reference them, so the link between a
 * person and their audits is a real foreign key, not a copy kept in step by
 * hand. Moving to RDS is a change to DATABASE_URL and nothing else.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // Deliberately fatal. The old behaviour of quietly falling back to a local
  // file made a production box with a missing variable look healthy while
  // saving accounts somewhere nobody would ever look.
  throw new Error("DATABASE_URL is not set. Login cannot work without the database.");
}

/**
 * Google sign-in is only offered when it is actually configured. Without this
 * the login page would show a button that fails on click, which reads to the
 * person using it as "this product is broken" rather than "this developer has
 * not added the keys yet".
 */
export const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export const auth = betterAuth({
  database: new Pool({ connectionString: databaseUrl }),
  // Where callbacks come back to. Google rejects a redirect it was not given,
  // so this has to match what is registered in the Google console exactly.
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  // The session-signing secret. A production box running on a guessable
  // default would let anyone forge a login cookie, so refuse to start.
  secret:
    process.env.BETTER_AUTH_SECRET ??
    (() => {
      if (process.env.NODE_ENV === "production") {
        throw new Error("BETTER_AUTH_SECRET is not set. Refusing to start.");
      }
      return "dev-only-secret-change-me";
    })(),
  emailAndPassword: {
    enabled: true,
    // Nothing sends email yet. Requiring verification here would let people
    // sign up and then lock them out of the account they just made.
    requireEmailVerification: false,
  },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
      }
    : {},
  // Must be last: it writes the session cookie through Next's cookie API,
  // which server actions and route handlers need in order to see it.
  plugins: [nextCookies()],
});
