"use client";

import { startTransition, type ComponentProps, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type NavLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

/**
 * A next/link that cross-fades the content area via the browser's View
 * Transitions API on a plain left-click, instead of snapping straight to
 * the new page - Chrome/Edge/Safari get the smooth swap, Firefox (no
 * startViewTransition) and modified clicks (new tab, etc.) just fall
 * through to Link's normal behavior.
 */
export function NavLink({ href, onClick, ...props }: NavLinkProps) {
  const router = useRouter();

  return (
    <Link
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          typeof document === "undefined" ||
          !document.startViewTransition
        ) {
          return;
        }
        event.preventDefault();
        document.startViewTransition(() => {
          startTransition(() => {
            router.push(href);
          });
        });
      }}
      {...props}
    />
  );
}
