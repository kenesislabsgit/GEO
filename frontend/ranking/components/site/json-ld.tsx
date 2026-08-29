/**
 * Renders schema.org structured data. `<` is escaped so page content can
 * never break out of the script tag (XSS via JSON.stringify).
 */
export function JsonLd({
  data,
  id = "json-ld",
}: {
  data: Record<string, unknown>;
  id?: string;
}) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
