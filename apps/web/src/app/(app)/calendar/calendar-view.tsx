'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
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

type CalendarViewMode = 'month' | 'agenda';

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

/**
 * Campaign & content calendar. Fetches CalendarEventDTOs for the visible
 * month and renders them as a month grid or a chronological agenda list.
 */
export function CalendarView() {
  const [currentMonth, setCurrentMonth] = React.useState<Date>(() => startOfMonth(new Date()));
  const [view, setView] = React.useState<CalendarViewMode>('month');

  const monthStart = React.useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const monthEnd = React.useMemo(() => endOfMonth(currentMonth), [currentMonth]);

  const query = useQuery({
    queryKey: ['calendar-events', monthStart.toISOString(), monthEnd.toISOString()],
    queryFn: () => api.calendar.events({ from: monthStart.toISOString(), to: monthEnd.toISOString() }),
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
  const isCurrentMonth = isSameMonth(currentMonth, new Date());

  return (
    <div className="space-y-6">
      <CalendarToolbar
        label={format(currentMonth, 'MMMM yyyy')}
        view={view}
        onViewChange={setView}
        onPrev={() => setCurrentMonth((m) => startOfMonth(subMonths(m, 1)))}
        onNext={() => setCurrentMonth((m) => startOfMonth(addMonths(m, 1)))}
        onToday={() => setCurrentMonth(startOfMonth(new Date()))}
        isCurrentMonth={isCurrentMonth}
        eventCount={events.length}
        isLoading={isLoading}
      />

      {isLoading ? (
        view === 'month' ? <MonthGridSkeleton /> : <AgendaSkeleton />
      ) : view === 'month' ? (
        <MonthGrid monthStart={monthStart} eventsByDay={eventsByDay} />
      ) : (
        <AgendaList eventsByDay={eventsByDay} />
      )}
    </div>
  );
}

function CalendarToolbar({
  label,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  isCurrentMonth,
  eventCount,
  isLoading,
}: {
  label: string;
  view: CalendarViewMode;
  onViewChange: (view: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isCurrentMonth: boolean;
  eventCount: number;
  isLoading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-soft">
          <Button variant="ghost" size="icon-sm" onClick={onPrev} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="min-w-[10ch] text-lg font-semibold tracking-tight">{label}</h2>
        <Button variant="outline" size="sm" onClick={onToday} disabled={isCurrentMonth}>
          Today
        </Button>
        {!isLoading ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {eventCount} {eventCount === 1 ? 'event' : 'events'} this month
          </span>
        ) : null}
      </div>

      <Tabs value={view} onValueChange={(v) => onViewChange(v as CalendarViewMode)}>
        <TabsList>
          <TabsTrigger value="month" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" /> Month
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
}: {
  monthStart: Date;
  eventsByDay: Map<string, CalendarEventDTO[]>;
}) {
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const rowCount = days.length / 7;
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
                  <EventPill key={event.id} event={event} />
                ))}
                {overflow > 0 ? <DayOverflow day={day} events={dayEvents} moreCount={overflow} /> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function EventPill({ event, className }: { event: CalendarEventDTO; className?: string }) {
  const meta = KIND_META[event.kind];
  return (
    <Link
      href={event.link}
      title={`${event.title} · ${meta.label}`}
      className={cn(
        'group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium leading-none text-foreground transition-colors hover:bg-surface-muted',
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
    </Link>
  );
}

function DayOverflow({ day, events, moreCount }: { day: Date; events: CalendarEventDTO[]; moreCount: number }) {
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
            <EventPill key={event.id} event={event} className="hover:bg-surface" />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AgendaList({ eventsByDay }: { eventsByDay: Map<string, CalendarEventDTO[]> }) {
  const sortedKeys = React.useMemo(() => [...eventsByDay.keys()].sort(), [eventsByDay]);

  if (sortedKeys.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled this month"
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
                <AgendaRow key={event.id} event={event} />
              ))}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function AgendaRow({ event }: { event: CalendarEventDTO }) {
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;
  const subtitle = [meta.label, event.brandName, event.influencerName].filter(Boolean).join(' · ');

  return (
    <Link
      href={event.link}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-brand/40 hover:bg-surface-muted hover:shadow-soft"
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
    </Link>
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
