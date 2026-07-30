import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Locale-pinned date formatting. Client components must use these instead of
 * toLocaleDateString() so server-rendered HTML matches hydration output
 * regardless of the visitor's system locale.
 */
export function formatDate(value: string | number | Date): string {
  return DATE_FORMAT.format(new Date(value));
}

export function formatDateTime(value: string | number | Date): string {
  return DATE_TIME_FORMAT.format(new Date(value));
}
