/**
 * Turning collected URLs into a list a person can read.
 *
 * Two problems, both visible on the Sources page:
 *
 * Every assistant that cites the same page adds its own row, so one page
 * appeared once per assistant that read it. The page looked padded, and the
 * one number that matters - how many distinct places write about a company - 
 * could not be counted off the screen.
 *
 * And every row was labelled with its domain, so kenesis.ai/products and
 * kenesis.ai/platform were both "kenesis.ai". Two different pages presented as
 * the same one, which is the opposite of what a sources list is for.
 */

/**
 * The same page reached by two routes is one page. Compared on host and path
 * only: the scheme, a www, a trailing slash, a tracking parameter and a #jump
 * all address the same document.
 */
export function canonicalUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    // Campaign parameters identify where a link was shared, never which page
    // it points at. Anything else may well select the content, so it stays.
    const params = new URLSearchParams(url.search);
    for (const key of Array.from(params.keys())) {
      if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(key)) params.delete(key);
    }
    params.sort();
    const query = params.toString();
    return `${host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return value.toLowerCase().replace(/\/+$/, "");
  }
}

/**
 * What to print for a link. A title when the page gave one, otherwise the
 * address including its path - never the bare domain, which would make every
 * page on a site look like the same page.
 */
export function sourceLabel(source: {
  title?: string | null;
  url: string;
  domain?: string | null;
}): string {
  const title = source.title?.trim();
  if (title) return title;
  const canonical = canonicalUrl(source.url);
  return canonical || source.domain || source.url;
}

/**
 * Collapses rows addressing the same page into one, keeping the first row seen
 * and counting how many collapsed into it. Order is preserved: these lists
 * arrive ranked, and re-sorting them here would silently override that.
 */
export function dedupeByUrl<T extends { url: string }>(
  rows: readonly T[],
): Array<T & { duplicateCount: number }> {
  const byUrl = new Map<string, T & { duplicateCount: number }>();
  for (const row of rows) {
    const key = canonicalUrl(row.url);
    if (!key) continue;
    const existing = byUrl.get(key);
    if (existing) existing.duplicateCount += 1;
    else byUrl.set(key, { ...row, duplicateCount: 1 });
  }
  return Array.from(byUrl.values());
}
