/**
 * One key per company, whatever form an assistant wrote its name in.
 *
 * "Kenesis", "Kenesis Labs", "Kenesis AI", "Kenesis Inc." and "kenesis.ai"
 * are one company. The engine groups competitors this way in
 * `GEO/geo_audit/aggregation.py` (`canonical_company_key`); anything here
 * that counts or dedupes company names must use the same rule, or the same
 * company appears twice on the page.
 *
 * Keep the two lists in step.
 */
const SUFFIX_WORDS = new Set([
  // Legal forms.
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "ag",
  "bv",
  "nv",
  "plc",
  "sa",
  "srl",
  "pty",
  "pvt",
  "private",
  "oy",
  "ab",
  "as",
  "sas",
  "sarl",
  // Generic descriptors, and the domain endings a model writes instead of a
  // name ("kenesis.ai").
  "lab",
  "labs",
  "tech",
  "technology",
  "technologies",
  "software",
  "solutions",
  "systems",
  "platform",
  "platforms",
  "group",
  "holdings",
  "ventures",
  "partners",
  "digital",
  "global",
  "international",
  "ai",
  "io",
  "com",
  "net",
  "org",
]);

export function canonicalCompanyKey(value: string | undefined | null): string {
  const words = (value ?? "").toLowerCase().match(/[a-z0-9+]+/g) ?? [];
  // Only whole trailing words go, so "OpenAI" stays "openai". The last word
  // is never dropped - a company actually called "Labs" keeps its name.
  while (words.length > 1 && SUFFIX_WORDS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}
