import Link from "next/link";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

export function Logo({
  className,
  invert = false,
  large = false,
}: {
  className?: string;
  invert?: boolean;
  large?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2.5 font-heading font-semibold tracking-tight",
        invert ? "text-white" : "text-foreground",
        large ? "text-2xl md:text-3xl" : "text-sm md:text-[15px]",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-lg font-bold",
          large ? "size-9 text-sm" : "size-6 text-[11px]",
          invert
            ? "bg-white text-[color:var(--rb-ink)]"
            : "bg-[color:var(--rb-ink)] text-white",
        )}
      >
        R
      </span>
      {APP_NAME}
    </Link>
  );
}
