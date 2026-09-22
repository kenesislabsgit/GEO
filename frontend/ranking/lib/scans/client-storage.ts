/** Browser persistence is optional; audits remain durable on the server. */
export function auditStorageKey(form: string, userId: string): string {
  return `${form}:${userId}`;
}

export function readAuditRun(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeAuditRun(key: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    // Storage restrictions must not prevent starting or finishing an audit.
  }
}
