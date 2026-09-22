import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";

export function publicPageMetadata(title: string, description: string, path: string): Metadata {
  const brandedTitle = `${title} · ${APP_NAME}`;
  return {
    title: { absolute: brandedTitle },
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      title: brandedTitle,
      description,
      siteName: APP_NAME,
      type: "website",
      url: path,
    },
    twitter: { card: "summary_large_image", title: brandedTitle, description },
  };
}
