import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 aria-hidden className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
