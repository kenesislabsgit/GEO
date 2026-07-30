import { stripWww } from "@/lib/security/url";

export function normalizeAlias(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildAliasSet(input: {
  name: string;
  domain: string;
  aliases?: string[];
}): string[] {
  const values = new Set<string>();
  values.add(normalizeAlias(input.name));
  values.add(normalizeAlias(stripWww(input.domain)));
  values.add(normalizeAlias(input.domain.split(".")[0] ?? ""));
  for (const alias of input.aliases ?? []) {
    const n = normalizeAlias(alias);
    if (n) values.add(n);
  }
  return Array.from(values).filter(Boolean);
}

export function findMatchedAlias(
  text: string,
  aliases: string[],
): string | null {
  const haystack = normalizeAlias(text);
  const sorted = [...aliases].sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    if (!alias || alias.length < 2) continue;
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(alias)}([^\\p{L}\\p{N}]|$)`,
      "iu",
    );
    if (pattern.test(haystack)) {
      return alias;
    }
  }
  return null;
}

export function citationSupportsBrand(
  citations: Array<{ url: string; domain?: string | null; citedForBrand?: boolean }>,
  brandDomain: string,
): boolean {
  const target = stripWww(brandDomain);
  for (const citation of citations) {
    if (citation.citedForBrand) return true;
    try {
      const host = stripWww(new URL(citation.url).hostname);
      if (host === target || host.endsWith(`.${target}`)) return true;
    } catch {
      if (citation.domain && stripWww(citation.domain) === target) return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
