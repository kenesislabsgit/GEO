import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * MagicUI's rainbow button (magicui.design/docs/components/rainbow-button):
 * a dark pill riding on an animated rainbow gradient border and underglow.
 * Ported to Tailwind v4 - the `animate-rainbow` utility and `--rainbow-*`
 * stops live in globals.css.
 */
export function RainbowButton({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      className={cn(
        "arc-rainbow-btn group relative inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-6 py-2 text-sm font-medium whitespace-nowrap text-primary-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}
