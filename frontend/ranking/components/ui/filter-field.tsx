import type { ReactNode } from "react";

/** A persistent label stays visible after a filter has a value. */
export function FilterField({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`flex min-w-0 flex-1 flex-col gap-2 text-xs font-medium sm:basis-0 ${wide ? "basis-full" : "basis-[calc(50%-0.5rem)]"}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
