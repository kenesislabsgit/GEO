import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";

export function publicPageMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  const brandedTitle = `${title} · ${APP_NAME}`;
  const image = `/social-image?${new URLSearchParams({ title, description })}`;
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
      images: [{ url: image, width: 1200, height: 630, alt: brandedTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: brandedTitle,
      description,
      images: [{ url: image, alt: brandedTitle }],
    },
  };
}
