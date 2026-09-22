import Link from "next/link";
import { routes } from "@/lib/routes";

export function VisibilityNotice() {
  return (
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
      New reports are public by default: anyone with the link can read the preview,
      and search engines may index it. Free includes public sharing. Plus and Pro
      let the owner switch a website to private in Website settings; claiming a
      report does not make it private. <Link href={routes.dataHandling} className="underline underline-offset-4">Report visibility and data handling</Link>.
    </p>
  );
}
