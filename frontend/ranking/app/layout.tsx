import type { Metadata } from "next";
import { validateEnv } from "@/lib/env";

// Fail fast: a production deploy with missing required configuration must
// not serve a single request.
validateEnv("web");
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { SITE_URL } from "@/lib/site";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const description =
  "See how your brand appears across AI answers, which competitors are winning, and what sources are shaping the results.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // The app already owns light/dark theming. Dark Reader rewrites SVG stroke
  // attributes before React hydrates, making the client DOM differ from the
  // server HTML and producing hydration errors on every Lucide icon.
  other: {
    "darkreader-lock": "",
  },
  title: {
    default: `${APP_NAME} - ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description,
  applicationName: APP_NAME,
  category: "technology",
  keywords: [
    "AI visibility",
    "generative engine optimization",
    "GEO",
    "answer engine optimization",
    "AI search optimization",
    "ChatGPT brand visibility",
    "AI brand monitoring",
  ],
  openGraph: {
    siteName: APP_NAME,
    title: `${APP_NAME} - ${APP_TAGLINE}`,
    description,
    type: "website",
    locale: "en_US",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} - ${APP_TAGLINE}`,
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col antialiased">
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
