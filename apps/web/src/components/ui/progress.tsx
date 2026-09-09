import { cn } from '@/lib/cn';

const PROGRESS_TONE_CLASSES = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  brand: 'bg-brand',
} as const;

export type ProgressTone = keyof typeof PROGRESS_TONE_CLASSES;

export interface ProgressBarProps {
  /** Current progress value. Values outside 0-100 are clamped. */
  value: number;
  /** Fill color for the bar. Defaults to 'primary'. */
  tone?: ProgressTone;
  className?: string;
  /** Show a right-aligned percentage label above the track. */
  showLabel?: boolean;
}

/** Slim rounded progress meter with an optional percent label. */
export function ProgressBar({ value, tone = 'primary', className, showLabel = false }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {showLabel ? (
        <div className="flex justify-end">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{Math.round(clamped)}%</span>
        </div>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300 ease-out', PROGRESS_TONE_CLASSES[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
