'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, MapPin, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatINR } from '@/lib/format';
import { ActiveHoldBanner, ActiveHoldInfo } from '@/components/ActiveHoldBanner';
import { VenueBadge, VENUE_LABELS, normalizeVenueType, VenueTypeKey } from '@/components/venue-badge';

interface EventItem {
  id: string;
  title: string;
  description: string | null;
  location?: string | null;
  imageUrl?: string | null;
  startsAt: string;
  status: string;
  venue: { id: string; name: string; layout?: { type?: string } };
  totalSeats: number;
  availableSeats: number;
  minPrice?: number;
  shows?: Array<{ id: string; startsAt: string; pricing?: any }>;
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

function EventRow({ event, onPrefetch }: { event: EventItem; onPrefetch: (id: string) => void }) {
  const date = new Date(event.startsAt);
  const soldOut = event.totalSeats > 0 && event.availableSeats === 0;
  const left = event.totalSeats > 0 ? event.availableSeats / event.totalSeats : 1;
  const fillingFast = !soldOut && left <= 0.2;
  const taken = event.totalSeats > 0 ? 1 - left : 0;

  return (
    <li>
      <Link
        href={`/events/${event.id}`}
        onMouseEnter={() => onPrefetch(event.id)}
        onFocus={() => onPrefetch(event.id)}
        onTouchStart={() => onPrefetch(event.id)}
        className="group card flex overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
      >
        {/* Date stub */}
        <div className="flex w-[72px] shrink-0 flex-col items-center justify-center border-r border-dashed border-line-strong bg-sunken/60 px-1 py-4 text-center sm:w-[104px] sm:px-2 sm:py-5">
          <span className="eyebrow text-[10px] sm:text-[11px]">{weekdayFmt.format(date)}</span>
          <span className="font-display text-[28px] font-bold leading-none tracking-tight sm:text-[42px]">
            {dayFmt.format(date)}
          </span>
          <span className="eyebrow mt-1 text-[10px] sm:text-[11px]">{monthFmt.format(date)}</span>
        </div>

        {event.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.imageUrl} alt="" loading="lazy" className="hidden h-auto w-28 shrink-0 object-cover sm:block" />
        )}

        {/* Details */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-3.5 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
          <div className="min-w-0 space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <VenueBadge type={event.venue?.layout?.type} />
              {event.shows && event.shows.length > 1 && (
                <span className="tag text-[10px] bg-accent-soft text-accent font-semibold">
                  {event.shows.length} shows
                </span>
              )}
            </div>
            <h2 className="font-display text-[18px] sm:text-2xl font-bold leading-snug tracking-tight">
              {event.title}
            </h2>
            {event.description && (
              <p className="line-clamp-2 max-w-xl text-xs sm:text-sm text-ink-2">{event.description}</p>
            )}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] sm:text-[13px] text-ink-3">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate max-w-[160px] sm:max-w-none">
                  {event.venue.name}
                  {event.location ? ` · ${event.location}` : ''}
                </span>
              </span>
              <span>{timeFmt.format(date).toUpperCase()}</span>
            </p>
          </div>

          <div className="flex flex-col gap-2.5 border-t border-line/60 pt-3 sm:w-48 sm:shrink-0 sm:border-0 sm:pt-0 sm:items-end sm:justify-center sm:gap-3">
            <div className="flex items-baseline justify-between sm:block sm:text-right">
              {event.minPrice && event.minPrice > 0 ? (
                <div>
                  <p className="eyebrow sm:block">From</p>
                  <p className="text-lg sm:text-xl font-semibold tabular-nums">{formatINR(event.minPrice)}</p>
                </div>
              ) : (
                <p className="eyebrow">Pricing on selection</p>
              )}

              <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent md:hidden">
                Pick seats <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>

            <div className="w-full space-y-1 sm:max-w-none">
              <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${fillingFast || soldOut ? 'bg-warn' : 'bg-accent'}`}
                  style={{ width: `${Math.round(taken * 100)}%` }}
                />
              </div>
              <p className={`text-[11px] sm:text-xs sm:text-right ${fillingFast ? 'font-medium text-warn' : 'text-ink-3'}`}>
                {soldOut
                  ? 'Sold out'
                  : fillingFast
                    ? `Selling fast · ${event.availableSeats} left`
                    : `${event.availableSeats} seats left`}
              </p>
            </div>
          </div>
        </div>

        <div className="hidden items-center pr-5 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-accent md:flex">
          <ArrowRight className="h-5 w-5" />
        </div>
      </Link>
    </li>
  );
}

export default function HomePage() {
  const queryClient = useQueryClient();
  const [venueFilter, setVenueFilter] = useState<'ALL' | VenueTypeKey>('ALL');

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ events: EventItem[] }>({
    queryKey: ['events'],
    queryFn: () => apiFetch('/api/events'),
  });

  const { data: holdData, refetch: refetchHold } = useQuery<{ hold: ActiveHoldInfo | null }>({
    queryKey: ['active-hold'],
    queryFn: () => apiFetch('/api/events/active-hold'),
    refetchInterval: 15000,
  });

  const events = data?.events ?? [];

  // Offer only the filters that would actually show something
  const filters = useMemo(() => {
    const counts = new Map<VenueTypeKey, number>();
    for (const e of events) {
      const key = normalizeVenueType(e.venue?.layout?.type);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }, [events]);

  const visible =
    venueFilter === 'ALL'
      ? events
      : events.filter((e) => normalizeVenueType(e.venue?.layout?.type) === venueFilter);

  function prefetch(eventId: string) {
    queryClient.prefetchQuery({
      queryKey: ['events', eventId, 'seats'],
      queryFn: () => apiFetch(`/api/events/${eventId}/seats`),
      staleTime: 30000,
    });
  }

  return (
    <main className="page max-w-5xl space-y-6 sm:space-y-8 py-6 sm:py-14 pb-safe">
      {holdData?.hold && <ActiveHoldBanner hold={holdData.hold} onReleased={() => refetchHold()} />}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5 sm:space-y-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            Upcoming events
          </h1>
          <p className="max-w-md text-[13px] sm:text-[15px] text-ink-2 leading-relaxed">
            Choose your own seats from the live map. Seats you pick are held for five minutes while you check out.
          </p>
        </div>

        {filters.length > 1 && (
          <div
            className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0"
            role="group"
            aria-label="Filter by venue type"
          >
            {[['ALL', 'All'] as const, ...filters.map(([k]) => [k, VENUE_LABELS[k]] as const)].map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={venueFilter === value}
                  onClick={() => setVenueFilter(value as 'ALL' | VenueTypeKey)}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                    venueFilter === value
                      ? 'border-ink bg-ink text-bg'
                      : 'border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading events">
          {[0, 1, 2].map((n) => (
            <div key={n} className="skeleton h-36" />
          ))}
        </div>
      ) : isError ? (
        <div className="card space-y-3 p-8 text-center">
          <p className="font-display text-xl font-semibold">We couldn’t load events</p>
          <p className="mx-auto max-w-sm text-sm text-ink-2">
            The server may still be starting up. Give it a moment and try again.
          </p>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="btn btn-secondary btn-sm">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Try again
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="card space-y-2 p-10 text-center">
          <p className="font-display text-xl font-semibold">
            {events.length === 0 ? 'Nothing scheduled yet' : 'No events match that filter'}
          </p>
          <p className="text-sm text-ink-2">
            {events.length === 0 ? 'New events show up here as soon as they are published.' : 'Try another venue type.'}
          </p>
          {events.length > 0 && (
            <button type="button" onClick={() => setVenueFilter('ALL')} className="btn btn-secondary btn-sm mt-2">
              Show all events
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((event) => (
            <EventRow key={event.id} event={event} onPrefetch={prefetch} />
          ))}
        </ul>
      )}
    </main>
  );
}
