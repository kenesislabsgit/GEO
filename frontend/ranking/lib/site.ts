/**
 * Canonical public origin for metadata, structured data, and crawler files.
 * Operational URLs (auth callbacks, local development, checkout) use their
 * own request/env origins and must not leak into public metadata.
 */
export const SITE_URL = "https://arcanoris.in";
