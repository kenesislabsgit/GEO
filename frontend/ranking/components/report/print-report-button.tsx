"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "PDF" for the report is the browser's print-to-PDF of this page — the
 * report is already a clean single document, and the print stylesheet hides
 * navigation and calls to action. No server-side renderer to maintain.
 */
export function PrintReportButton() {
  return (
    <Button
      onClick={() => window.print()}
      size="sm"
      variant="outline"
      className="print:hidden"
    >
      <Printer className="size-3.5" aria-hidden /> Save as PDF
    </Button>
  );
}
