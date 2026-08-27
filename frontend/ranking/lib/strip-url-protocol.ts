const LEADING_PROTOCOL = /^(https?:\/\/)+/i;

/**
 * The hero field already shows a `https://` prefix. Strip a pasted or typed
 * protocol (and any path/query) so the value is just the host.
 */
export function stripUrlProtocolForInput(value: string): string {
  let next = value.replace(LEADING_PROTOCOL, "").replace(/^\/\//, "");
  const cut = next.search(/[/?#]/);
  if (cut > 0) {
    next = next.slice(0, cut);
  }
  return next.replace(/\/+$/, "");
}
