'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ColumnsIcon,
  ExternalLink,
  FlagTriangleRight,
  LayoutGrid,
  Rocket,
  Rows3,
  type LucideIcon,
} from 'lucide-react';
import type { CalendarEventDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { toast } from 'sonner';
import { api } from '@/lib/api-browser';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformIcon } from '@/components/ui/platform-badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type CalendarViewMode = 'month' | 'week' | 'agenda';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_PER_DAY = 3;

const KIND_META: Record<
  CalendarEventDTO['kind'],
  { label: string; icon: LucideIcon; dot: string; tint: string }
> = {
  CAMPAIGN_START: { label: 'Campaign start', icon: Rocket, dot: 'bg-info', tint: 'bg-info/10 text-info' },
  CAMPAIGN_END: {
    label: 'Campaign end',
    icon: FlagTriangleRight,
    dot: 'bg-muted-foreground',
    tint: 'bg-surface-muted text-muted-foreground',
  },
  DELIVERABLE_DUE: { label: 'Deliverable due', icon: Clock3, dot: 'bg-warning', tint: 'bg-warning/10 text-warning' },
  EXPECTED_PUBLISH: {
    label: 'Expected publish',
    icon: CalendarClock,
    dot: 'bg-accent',
    tint: 'bg-accent/10 text-accent',
  },
  PUBLISHED: { label: 'Published', icon: CheckCircle2, dot: 'bg-success', tint: 'bg-success/10 text-success' },
};

function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** The visible date range for the current view. */
function rangeFor(anchor: Date, view: CalendarViewMode): { from: Date; to: Date } {
  if (view === 'week') {
    return { from: startOfWeek(anchor, { weekStartsOn: 0 }), to: endOfWeek(anchor, { weekStartsOn: 0 }) };
  }
  return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
}

/**
 * Campaign & content calendar. Fetches CalendarEventDTOs for the visible range
 * and renders them as a month grid, a week column view, or a chronological
 * agenda. Selecting any event opens a quick-preview drawer.
 */
export function CalendarView() {
  const [anchor, setAnchor] = React.useState<Date>(() => new Date());
  const [view, setView] = React.useState<CalendarViewMode>('month');
  const [selected, setSelected] = React.useState<CalendarEventDTO | null>(null);

  const { from, to } = React.useMemo(() => rangeFor(anchor, view), [anchor, view]);

  const query = useQuery({
    queryKey: ['calendar-events', from.toISOString(), to.toISOString()],
    queryFn: () => api.calendar.events({ from: from.toISOString(), to: to.toISOString() }),
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (query.error) {
      toast.error(query.error instanceof ApiError ? query.error.message : 'Could not load the calendar.');
    }
  }, [query.error]);

  const events = React.useMemo(() => query.data ?? [], [query.data]);

  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, CalendarEventDTO[]>();
    for (const event of events) {
      const key = dayKey(parseISO(event.date));
      const list = map.get(key);
      if (list) list.push(event);
      else map.set(key, [event]);
    }
    for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return map;
  }, [events]);

  const isLoading = query.isLoading;
  const isCurrent = view === 'week' ? isSameWeek(anchor, new Date()) : isSameMonth(anchor, new Date());

  function step(dir: 1 | -1) {
    setAnchor((a) => (view === 'week' ? (dir === 1 ? addWeeks(a, 1) : subWeeks(a, 1)) : dir === 1 ? addMonths(a, 1) : subMonths(a, 1)));
  }

  const label =
    view === 'week'
      ? `${format(from, 'MMM d')} – ${format(to, isSameMonth(from, to) ? 'd, yyyy' : 'MMM d, yyyy')}`
      : format(anchor, 'MMMM yyyy');

  return (
    <div className="space-y-6">
      <CalendarToolbar
        label={label}
        view={view}
        onViewChange={setView}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onToday={() => setAnchor(new Date())}
        isCurrent={isCurrent}
        eventCount={events.length}
        isLoading={isLoading}
      />

      {isLoading ? (
        view === 'agenda' ? <AgendaSkeleton /> : <MonthGridSkeleton />
      ) : view === 'month' ? (
        <MonthGrid monthStart={startOfMonth(anchor)} eventsByDay={eventsByDay} onSelect={setSelected} />
      ) : view === 'week' ? (
        <WeekView weekStart={from} eventsByDay={eventsByDay} onSelect={setSelected} />
      ) : (
        <AgendaList eventsByDay={eventsByDay} onSelect={setSelected} />
      )}

      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function isSameWeek(a: Date, b: Date): boolean {
  return isSameDay(startOfWeek(a, { weekStartsOn: 0 }), startOfWeek(b, { weekStartsOn: 0 }));
}

function CalendarToolbar({
  label,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  isCurrent,
  eventCount,
  isLoading,
}: {
  label: string;
  view: CalendarViewMode;
  onViewChange: (view: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isCurrent: boolean;
  eventCount: number;
  isLoading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-soft">
          <Button variant="ghost" size="icon-sm" onClick={onPrev} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="min-w-[10ch] text-lg font-semibold tracking-tight">{label}</h2>
        <Button variant="outline" size="sm" onClick={onToday} disabled={isCurrent}>
          Today
        </Button>
        {!isLoading ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {eventCount} {eventCount === 1 ? 'event' : 'events'}
          </span>
        ) : null}
      </div>

      <Tabs value={view} onValueChange={(v) => onViewChange(v as CalendarViewMode)}>
        <TabsList>
          <TabsTrigger value="month" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" /> Month
          </TabsTrigger>
          <TabsTrigger value="week" className="gap-1.5">
            <ColumnsIcon className="h-3.5 w-3.5" /> Week
          </TabsTrigger>
          <TabsTrigger value="agenda" className="gap-1.5">
            <Rows3 className="h-3.5 w-3.5" /> Agenda
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

function MonthGrid({
  monthStart,
  eventsByDay,
  onSelect,
}: {
  monthStart: Date;
  eventsByDay: Map<string, CalendarEventDTO[]>;
  onSelect: (event: CalendarEventDTO) => void;
}) {
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = new Date();

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-border bg-surface-muted/60">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const key = dayKey(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const inMonth = isSameMonth(day, monthStart);
          const isLastCol = (index + 1) % 7 === 0;
          const isLastRow = index >= days.length - 7;
          const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY);
          const overflow = dayEvents.length - visible.length;

          return (
            <div
              key={key}
              className={cn(
                'flex min-h-[132px] flex-col gap-1 border-b border-r border-border p-2 transition-colors',
                isLastCol && 'border-r-0',
                isLastRow && 'border-b-0',
                !inMonth && 'bg-surface-muted/30',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                  isSameDay(day, today) ? 'bg-brand text-brand-foreground' : inMonth ? 'text-foreground' : 'text-muted-foreground/50',
                )}
              >
                {format(day, 'd')}
              </span>

              <div className="flex flex-1 flex-col gap-1 overflow-hidden">
                {visible.map((event) => (
                  <EventPill key={event.id} event={event} onSelect={onSelect} />
                ))}
                {overflow > 0 ? <DayOverflow day={day} events={dayEvents} moreCount={overflow} onSelect={onSelect} /> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekView({
  weekStart,
  eventsByDay,
  onSelect,
}: {
  weekStart: Date;
  eventsByDay: Map<string, CalendarEventDTO[]>;
  onSelect: (event: CalendarEventDTO) => void;
}) {
  const days = eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 0 }) });
  const today = new Date();

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-1 sm:grid-cols-7">
        {days.map((day, index) => {
          const key = dayKey(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isTodayCol = isSameDay(day, today);
          return (
            <div
              key={key}
              className={cn(
                'flex min-h-[420px] flex-col border-b border-border sm:border-b-0 sm:border-r sm:last:border-r-0',
                isTodayCol && 'bg-brand-soft/20',
              )}
            >
              <div className="flex items-center justify-between border-b border-border bg-surface-muted/60 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {format(day, 'EEE')}
                </span>
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                    isTodayCol ? 'bg-brand text-brand-foreground' : 'text-foreground',
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-2">
                {dayEvents.length === 0 ? (
                  <span className="px-1 py-2 text-[11px] text-muted-foreground/60">—</span>
                ) : (
                  dayEvents.map((event) => <WeekEventCard key={event.id} event={event} onSelect={onSelect} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekEventCard({ event, onSelect }: { event: CalendarEventDTO; onSelect: (event: CalendarEventDTO) => void }) {
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={cn('flex items-start gap-1.5 rounded-lg border border-border p-1.5 text-left transition-colors hover:bg-surface-muted', meta.tint)}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold leading-tight text-foreground">{event.title}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{meta.label}</span>
      </span>
    </button>
  );
}

function EventPill({
  event,
  className,
  onSelect,
}: {
  event: CalendarEventDTO;
  className?: string;
  onSelect: (event: CalendarEventDTO) => void;
}) {
  const meta = KIND_META[event.kind];
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      title={`${event.title} · ${meta.label}`}
      className={cn(
        'group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium leading-none text-foreground transition-colors hover:bg-surface-muted',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', !event.brandColor && meta.dot)}
        style={event.brandColor ? { backgroundColor: event.brandColor } : undefined}
      />
      {event.platform ? <PlatformIcon platform={event.platform} className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
      <span className="truncate group-hover:underline">{event.title}</span>
    </button>
  );
}

function DayOverflow({
  day,
  events,
  moreCount,
  onSelect,
}: {
  day: Date;
  events: CalendarEventDTO[];
  moreCount: number;
  onSelect: (event: CalendarEventDTO) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          +{moreCount} more
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{format(day, 'EEEE, MMM d')}</p>
        <div className="flex flex-col gap-0.5">
          {events.map((event) => (
            <EventPill key={event.id} event={event} className="hover:bg-surface" onSelect={onSelect} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AgendaList({
  eventsByDay,
  onSelect,
}: {
  eventsByDay: Map<string, CalendarEventDTO[]>;
  onSelect: (event: CalendarEventDTO) => void;
}) {
  const sortedKeys = React.useMemo(() => [...eventsByDay.keys()].sort(), [eventsByDay]);

  if (sortedKeys.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled"
        description="Campaign milestones, deliverables and publish dates will appear here as they're scheduled."
      />
    );
  }

  const today = new Date();

  return (
    <Card className="divide-y divide-border p-0">
      {sortedKeys.map((key) => {
        const dayEvents = eventsByDay.get(key) ?? [];
        const day = parseISO(key);
        return (
          <div key={key} className="flex flex-col gap-3 p-5 sm:flex-row sm:gap-6">
            <div className="flex shrink-0 items-center gap-2 sm:w-40 sm:flex-col sm:items-start">
              <div>
                <p className="text-sm font-semibold">{format(day, 'EEEE')}</p>
                <p className="text-xs text-muted-foreground">{format(day, 'MMMM d, yyyy')}</p>
              </div>
              {isSameDay(day, today) ? (
                <Badge tone="accent" solid className="bg-brand text-brand-foreground">
                  Today
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {dayEvents.map((event) => (
                <AgendaRow key={event.id} event={event} onSelect={onSelect} />
              ))}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function AgendaRow({ event, onSelect }: { event: CalendarEventDTO; onSelect: (event: CalendarEventDTO) => void }) {
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;
  const subtitle = [meta.label, event.brandName, event.influencerName].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-brand/40 hover:bg-surface-muted hover:shadow-soft"
    >
      <span
        className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', !event.brandColor && meta.tint)}
        style={event.brandColor ? { backgroundColor: `${event.brandColor}1a`, color: event.brandColor } : undefined}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{event.title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {event.platform ? <PlatformIcon platform={event.platform} className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
      <span className="shrink-0 text-xs text-muted-foreground">{format(parseISO(event.date), 'MMM d')}</span>
    </button>
  );
}

function EventDrawer({ event, onClose }: { event: CalendarEventDTO | null; onClose: () => void }) {
  const meta = event ? KIND_META[event.kind] : null;
  const Icon = meta?.icon;
  return (
    <Sheet open={Boolean(event)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {event && meta ? (
          <div className="space-y-5">
            <SheetHeader className="space-y-3 text-left">
              <div className="flex items-center gap-3">
                <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', meta.tint)}>
                  {Icon ? <Icon className="h-5 w-5" /> : null}
                </span>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{event.title}</SheetTitle>
                  <SheetDescription>{meta.label}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-3">
              <DetailRow label="Date" value={format(parseISO(event.date), 'EEEE, MMMM d, yyyy')} />
              {event.brandName ? <DetailRow label="Brand" value={event.brandName} /> : null}
              {event.influencerName ? <DetailRow label="Influencer" value={event.influencerName} /> : null}
              {event.platform ? <DetailRow label="Platform" value={event.platform} /> : null}
            </div>

            <Button asChild className="w-full">
              <Link href={event.link}>
                <ExternalLink className="h-4 w-4" /> Open
              </Link>
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2.5 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function MonthGridSkeleton() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-border bg-surface-muted/60">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-3 py-2.5">
            <Skeleton className="mx-auto h-3 w-8" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'flex min-h-[132px] flex-col gap-2 border-b border-r border-border p-2',
              (i + 1) % 7 === 0 && 'border-r-0',
              i >= 35 && 'border-b-0',
            )}
          >
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-3 w-full" />
            {i % 4 === 0 ? <Skeleton className="h-3 w-2/3" /> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AgendaSkeleton() {
  return (
    <Card className="divide-y divide-border p-0">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 p-5 sm:flex-row sm:gap-6">
          <div className="shrink-0 space-y-1.5 sm:w-40">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </Card>
  );
}
