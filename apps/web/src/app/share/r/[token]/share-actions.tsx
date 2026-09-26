'use client';

import { FileSpreadsheet, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Print / save as PDF and the Excel download on a shared report. Labels come in the report's language. */
export function ShareActions({
  excelHref,
  printLabel,
  excelLabel,
}: {
  excelHref: string;
  printLabel: string;
  excelLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
      <Button variant="outline" size="sm" asChild>
        <a href={excelHref} download rel="nofollow">
          <FileSpreadsheet className="h-4 w-4" /> {excelLabel}
        </a>
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> {printLabel}
      </Button>
    </div>
  );
}
