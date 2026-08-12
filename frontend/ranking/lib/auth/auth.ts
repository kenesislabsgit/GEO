import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import path from "path";

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
 * The store is a local file today and a connection string later: nothing above
 * this file knows which, so moving to RDS is a change to AUTH_DATABASE_URL and
 * nothing else.
 */
const databaseUrl =
  process.env.AUTH_DATABASE_URL ??
  `file:${path.join(process.cwd(), ".data", "auth.db")}`;

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
  database: {
    dialect: new LibsqlDialect({ url: databaseUrl }),
    type: "sqlite",
  },
  // Where callbacks come back to. Google rejects a redirect it was not given,
  // so this has to match what is registered in the Google console exactly.
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me",
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
