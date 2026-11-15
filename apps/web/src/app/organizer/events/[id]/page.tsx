'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatINR, formatEventDateTime } from '@/lib/format';
import { VenueBadge } from '@/components/venue-badge';
import { DeleteEventModal } from '@/components/DeleteEventModal';
import { ShowManager, ShowTimingItem } from '@/components/ShowManager';

interface TierStat {
  tier: string;
  total: number;
  sold: number;
  held: number;
  available: number;
  price: number;
  revenue: number;
  occupancyRate: number;
}

interface EventStatsResponse {
  event: {
    id: string;
    title: string;
    description?: string;
    location?: string | null;
    startsAt: string;
    venueName: string;
    venueType?: string;
  };
  overview: {
    totalSeats: number;
    soldSeats: number;
    heldSeats: number;
    availableSeats: number;
    occupancyRate: number;
    revenueCents: number;
  };
  checkIn: {
    totalTickets: number;
    checkedInCount: number;
    checkInRate: number;
  };
  tiers: TierStat[];
  shows?: ShowTimingItem[];
  recentOrders: Array<{
    id: string;
    userEmail: string;
    totalCents: number;
    createdAt: string;
    seats: string[];
  }>;
}

export default function EventAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = use(params);
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<EventStatsResponse>({
    queryKey: ['organizer', 'event', eventId, 'stats'],
    queryFn: () => apiFetch(`/api/organizer/events/${eventId}/stats`),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <main className="page max-w-6xl space-y-4 py-10" aria-busy="true">
        <div className="skeleton h-12 w-80" />
        <div className="skeleton h-40" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="page max-w-md space-y-4 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold">Couldn’t load this event</h1>
        <p className="text-sm text-ink-2">You need to be signed in as the organizer who created this event.</p>
        <Link href="/organizer" className="btn btn-secondary btn-sm">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const { event, overview, checkIn, tiers, recentOrders } = data;

  const stat = (label: string, value: React.ReactNode, hint: string, bar?: number) => (
    <div className="card p-3 sm:p-5 min-w-0 overflow-hidden">
      <p className="eyebrow text-[10px] sm:text-[11px] truncate">{label}</p>
      <p className="mt-1 sm:mt-2 text-lg sm:text-3xl font-semibold tabular-nums tracking-tight break-all">{value}</p>
      {bar !== undefined && (
        <div className="mt-2.5 sm:mt-3 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, bar)}%` }} />
        </div>
      )}
      <p className="mt-1.5 sm:mt-2 text-[11px] sm:text-xs text-ink-3 truncate">{hint}</p>
    </div>
  );

  return (
    <main className="page max-w-6xl space-y-6 sm:space-y-8 py-6 sm:py-12 pb-safe">
      <header className="space-y-2.5 sm:space-y-3">
        <Link href="/organizer" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="space-y-1.5 sm:space-y-2">
            {event.venueType && <VenueBadge type={event.venueType} />}
            <h1 className="font-display text-xl sm:text-3xl md:text-4xl font-bold tracking-tight">{event.title}</h1>
            <p className="text-xs sm:text-sm text-ink-2">
              {event.venueName}{event.location ? ` · ${event.location}` : ''} · {formatEventDateTime(event.startsAt)}
            </p>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <Link href={`/organizer/events/${event.id}/edit`} className="btn btn-edit btn-sm flex-1 sm:flex-initial">
              <Pencil className="h-3.5 w-3.5" />
              Edit event
            </Link>
            <Link href={`/events/${event.id}`} className="btn btn-secondary btn-sm flex-1 sm:flex-initial">
              Public page
            </Link>
            <Link href="/staff/scanner" className="btn btn-secondary btn-sm flex-1 sm:flex-initial">
              Scanner
            </Link>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="btn btn-delete btn-sm flex-1 sm:flex-initial"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete event
            </button>
          </div>
        </div>
      </header>

      <DeleteEventModal
        isOpen={deleteOpen}
        eventId={event.id}
        eventTitle={event.title}
        soldTicketsCount={overview.soldSeats}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => router.push('/organizer')}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {stat('Revenue', formatINR(overview.revenueCents), `${overview.soldSeats} seats sold`)}
        {stat('Occupancy', `${overview.occupancyRate}%`, `${overview.availableSeats} open · ${overview.heldSeats} held`, overview.occupancyRate)}
        {stat('Sold', <>{overview.soldSeats}<span className="ml-1 text-sm sm:text-base font-normal text-ink-3">/ {overview.totalSeats}</span></>, 'Seats confirmed')}
        {stat('Checked in', <>{checkIn.checkedInCount}<span className="ml-1 text-sm sm:text-base font-normal text-ink-3">/ {checkIn.totalTickets}</span></>, `${checkIn.checkInRate}% entered`, checkIn.checkInRate)}
      </div>

      {/* Show timings only exist for cinema events */}
      {event.venueType === 'THEATER_DOLBY' && (
        <ShowManager mode="live" eventId={event.id} shows={data.shows || []} onUpdated={() => refetch()} />
      )}

      <section className="space-y-3" aria-labelledby="tiers-h">
        <h2 id="tiers-h" className="font-display text-xl sm:text-2xl font-semibold">By section</h2>
        {/* Mobile cards for tiers */}
        <div className="card divide-y divide-line sm:hidden">
          {tiers.map((t) => (
            <div key={t.tier} className="p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold capitalize text-sm">{t.tier.toLowerCase()}</span>
                <span className="tabular-nums font-medium text-sm">{formatINR(t.price)}</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-ink-3">
                  <span>Occupancy: {t.occupancyRate}%</span>
                  <span className="tabular-nums">{t.sold} / {t.total} sold</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-accent" style={{ width: `${t.occupancyRate}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-ink-3 pt-0.5">
                <span>{t.held} held · {t.available} open</span>
                <span className="font-medium text-ink tabular-nums">Rev: {formatINR(t.revenue)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="card overflow-x-auto hidden sm:block">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-3">
              <tr>
                <th className="px-5 py-3 font-medium">Section</th>
                <th className="px-3 py-3 text-right font-medium">Price</th>
                <th className="px-3 py-3 font-medium">Sold</th>
                <th className="px-3 py-3 text-right font-medium">Held</th>
                <th className="px-3 py-3 text-right font-medium">Open</th>
                <th className="px-5 py-3 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tiers.map((t) => (
                <tr key={t.tier}>
                  <td className="px-5 py-3 font-medium capitalize">{t.tier.toLowerCase()}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatINR(t.price)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                        <div className="h-full bg-accent" style={{ width: `${t.occupancyRate}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-ink-3">{t.sold}/{t.total}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-2">{t.held}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-2">{t.available}</td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">{formatINR(t.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="orders-h">
        <h2 id="orders-h" className="font-display text-xl sm:text-2xl font-semibold">Recent orders</h2>
        {recentOrders.length === 0 ? (
          <p className="card p-6 sm:p-8 text-center text-sm text-ink-3">No orders for this event yet.</p>
        ) : (
          <div className="card divide-y divide-line">
            {recentOrders.map((o) => (
              <div key={o.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3 p-3.5 sm:px-5 sm:py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{o.userEmail}</p>
                  <p className="text-xs text-ink-3">Seats {o.seats.join(', ')}</p>
                </div>
                <div className="flex items-baseline justify-between sm:block sm:text-right border-t border-line/60 pt-1.5 sm:border-0 sm:pt-0">
                  <p className="font-medium tabular-nums">{formatINR(o.totalCents)}</p>
                  <p className="text-xs text-ink-3">{new Date(o.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
