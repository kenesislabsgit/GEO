"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { routes } from "@/lib/routes";

export function MobileNav({
  links,
  signedIn,
}: {
  links: readonly { href: string; label: string }[];
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 md:hidden" aria-label="Open menu">
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent aria-describedby={undefined} className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav aria-label="Mobile navigation" className="flex flex-col gap-1 px-4">
          {[
            ...links,
            signedIn
              ? { href: routes.dashboard, label: "Dashboard" }
              : { href: routes.login({ mode: "signin" }), label: "Sign in" },
          ].map((item) => (
            <SheetClose asChild key={item.href}>
              <Link href={item.href} className="rounded-md px-3 py-3 text-base font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                {item.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
        <div className="mx-4 flex items-center justify-between border-t border-border px-3 pt-4">
          <span className="text-sm font-medium">Theme</span>
          <ThemeToggle className="size-11" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
