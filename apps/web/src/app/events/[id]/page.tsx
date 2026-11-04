'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calendar, MapPin, RefreshCw } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatEventDateTime } from '@/lib/format';
import { SeatMap, SeatData } from '@/components/seat-map/SeatMap';
import { CartPanel } from '@/components/seat-map/CartPanel';
import { useCartStore } from '@/store/cartStore';
import { useEventSocket } from '@/hooks/useEventSocket';
import { VenueBadge } from '@/components/venue-badge';

interface EventPageProps {
  params: Promise<{ id: string }>;
}

interface SeatsResponse {
  eventId: string;
  event?: { id: string; title: string; description?: string; location?: string | null; imageUrl?: string | null; startsAt: string; capacity?: number };
  venue: { id: string; name: string; layout: any };
  seats: SeatData[];
}

export default function EventSeatMapPage({ params }: EventPageProps) {
  const { id: eventId } = use(params);
  useEventSocket(eventId);

  const { eventId: cartEventId, heldSeatIds, restoreHold, clearHold, setEventId } = useCartStore();

  useEffect(() => {
    setEventId(eventId);
  }, [eventId, setEventId]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<SeatsResponse>({
    queryKey: ['events', eventId, 'seats'],
    queryFn: () => apiFetch(`/api/events/${eventId}/seats`),
    staleTime: 10000,
  });

  // Mirror the server's view of *our* holds into the cart (covers reloads and other tabs)
  useEffect(() => {
    if (!data?.seats || isFetching) return;

    const now = Date.now();
    const mine = data.seats.filter(
      (s) => s.status === 'HELD' && s.isHeldByMe && s.holdExpiresAt && new Date(s.holdExpiresAt).getTime() > now,
    );

    if (mine.length > 0) {
      const earliest = mine.reduce((min, s) => (s.holdExpiresAt! < min ? s.holdExpiresAt! : min), mine[0]!.holdExpiresAt!);
      restoreHold(
        eventId,
        mine.map((s) => ({
          id: s.id,
          seatId: s.seatId,
          section: s.section,
          row: s.row,
          number: s.number,
          tier: s.tier,
          price: s.price,
        })),
        earliest,
      );
    } else if (cartEventId === eventId && heldSeatIds.length > 0) {
      // We think we hold seats but the server disagrees (expired, or released elsewhere)
      clearHold();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.seats, isFetching, eventId]);

  if (isLoading) {
    return (
      <main className="page max-w-7xl space-y-5 py-8" aria-busy="true">
        <div className="skeleton h-24" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="skeleton h-[520px]" />
          <div className="skeleton hidden h-64 lg:block" />
        </div>
      </main>
    );
  }

  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="page max-w-md space-y-4 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold">
          {notFound ? 'We can’t find that event' : 'Couldn’t load the seat map'}
        </h1>
        <p className="text-sm text-ink-2">
          {notFound ? 'It may have been removed or the link is out of date.' : 'Check your connection and try again.'}
        </p>
        <div className="flex justify-center gap-2">
          {!notFound && (
            <button type="button" onClick={() => refetch()} className="btn btn-secondary btn-sm">
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
          <Link href="/" className="btn btn-primary btn-sm">
            All events
          </Link>
        </div>
      </main>
    );
  }

  const { venue, seats, event } = data;
  const availableCount = seats.filter((s) => s.status === 'AVAILABLE').length;
  const started = event?.startsAt ? new Date(event.startsAt).getTime() < Date.now() : false;

  return (
    <main className="page max-w-7xl space-y-5 sm:space-y-6 py-5 pb-cart-mobile sm:py-8 lg:pb-8">
      <header className="space-y-2.5 sm:space-y-3">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" />
            All events
          </Link>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="btn btn-secondary btn-sm sm:hidden">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="space-y-1.5 sm:space-y-2">
            <VenueBadge type={venue?.layout?.type} />
            <h1 className="break-words font-display text-2xl font-bold tracking-tight sm:text-4xl">
              {event?.title || 'Choose your seats'}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] sm:text-[13px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-ink-3 shrink-0" />
                <span className="font-medium">{venue.name}</span>
                {event?.location && <span className="text-ink-3">· {event.location}</span>}
              </span>
              {event?.startsAt && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-ink-3 shrink-0" />
                  {formatEventDateTime(event.startsAt)}
                </span>
              )}
              <span className="tabular-nums">
                {availableCount} of {seats.length} seats open
              </span>
              <span className="inline-flex items-center gap-1.5 text-ok font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-50" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
                </span>
                Updating live
              </span>
            </p>
          </div>

          <button type="button" onClick={() => refetch()} disabled={isFetching} className="btn btn-secondary btn-sm hidden sm:inline-flex shrink-0">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {event?.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.imageUrl} alt="" className="max-h-56 w-full rounded-xl border border-line object-cover" />
      )}

      {event?.description && <p className="max-w-3xl text-sm text-ink-2">{event.description}</p>}

      {started && (
        <p className="notice notice-warn">This event has already started, so seats can no longer be booked.</p>
      )}

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 w-full">
          <SeatMap seats={seats} venueLayout={venue.layout} />
        </div>
        <CartPanel eventId={eventId} onHoldSuccess={() => refetch()} onReleaseSuccess={() => refetch()} />
      </div>
    </main>
  );
}
