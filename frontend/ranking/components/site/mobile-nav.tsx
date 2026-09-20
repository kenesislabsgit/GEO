"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { routes } from "@/lib/routes";

const links = [
  { href: routes.pricing, label: "Pricing" },
  { href: routes.methodology, label: "Methodology" },
  { href: routes.blog, label: "Blog" },
];

export function MobileNav({ signedIn }: { signedIn: boolean }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="md:hidden">
          <Menu aria-hidden />
          <span className="sr-only">Open menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="p-2 md:hidden">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col px-2">
          {links.map((item) => (
            <SheetClose key={item.href} asChild>
              <Link href={item.href} className="rounded-lg px-3 py-3 text-base">
                {item.label}
              </Link>
            </SheetClose>
          ))}
          {signedIn ? (
            <SheetClose asChild>
              <Link href={routes.dashboard} className="rounded-lg px-3 py-3 text-base">
                Dashboard
              </Link>
            </SheetClose>
          ) : null}
        </nav>
        <div className="mt-auto flex items-center justify-between border-t border-border p-4">
          <span className="text-sm text-muted-foreground">Appearance</span>
          <ThemeToggle />
        </div>
      </SheetContent>
    </Sheet>
  );
}
