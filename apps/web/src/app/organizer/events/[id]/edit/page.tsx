'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatINR } from '@/lib/format';
import { VenueBadge } from '@/components/venue-badge';
import { MAX_SEATS_PER_EVENT, optionalText } from '@/lib/seating';
import { DeleteEventModal } from '@/components/DeleteEventModal';
import { ShowManager, type ShowTimingItem } from '@/components/ShowManager';
import { toLocalInput } from '@/lib/shows';

type Tier = 'VIP' | 'PREMIUM' | 'STANDARD';
const TIERS: Tier[] = ['VIP', 'PREMIUM', 'STANDARD'];
const TIER_LABEL: Record<Tier, string> = { VIP: 'VIP', PREMIUM: 'Premium', STANDARD: 'Standard' };

interface EditData {
  event: {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    imageUrl: string | null;
    startsAt: string;
    status: string;
    updatedAt: string;
    venueName: string;
    venueType: string;
  };
  /** Cinema events are scheduled by their shows, not by a single start time or price list. */
  isCinema: boolean;
  /** True for every cinema, including older ones that have no show timings yet. */
  canManageShows: boolean;
  shows?: ShowTimingItem[];
  seating: {
    capacity: number;
    seatsPerRow: number;
    sold: number;
    held: number;
    available: number;
    showCount: number;
    minCapacity: number;
    maxCapacity: number;
    tiers: Array<{ tier: string; total: number; sold: number; held: number; available: number }>;
  };
  pricing: Record<Tier, number | null>;
  editable: boolean;
}

interface SaveResult {
  event: { id: string; capacity: number };
  summary: {
    capacity: number;
    sold: number;
    held: number;
    available: number;
    seatsAdded: number;
    seatsRemoved: number;
    changes: string[];
    pricing: Array<{ tier: string; price: number; updatedSeats: number; keptSoldSeats: number; keptHeldSeats: number }>;
  };
  notifiedCustomers: number;
}

function paiseToRupees(paise: number | null | undefined) {
  return paise == null ? '' : String(paise / 100);
}

export default function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery<EditData>({
    queryKey: ['organizer', 'event', eventId, 'edit'],
    queryFn: () => apiFetch(`/api/organizer/events/${eventId}`),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [form, setForm] = useState({
    title: '',
    description: '',
    startsAt: '',
    venueName: '',
    location: '',
    imageUrl: '',
    totalSeats: '',
    VIP: '',
    PREMIUM: '',
    STANDARD: '',
  });
  // The form is filled from the server once, and again only on request (after a save or "Reload
  // latest"). Show changes also bump the event's updatedAt, and must not wipe unsaved edits.
  const [formReady, setFormReady] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [stale, setStale] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  useEffect(() => {
    if (!data || formReady) return;
    setForm({
      title: data.event.title,
      description: data.event.description ?? '',
      startsAt: toLocalInput(data.event.startsAt),
      venueName: data.event.venueName,
      location: data.event.location ?? '',
      imageUrl: data.event.imageUrl ?? '',
      totalSeats: String(data.seating.capacity),
      VIP: paiseToRupees(data.pricing.VIP),
      PREMIUM: paiseToRupees(data.pricing.PREMIUM),
      STANDARD: paiseToRupees(data.pricing.STANDARD),
    });
    setFormReady(true);
    setReviewing(false);
    setAcknowledged(false);
    setNeedsConfirm(false);
    setStale(false);
  }, [data, formReady]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  /** Only the fields that differ from what is saved. */
  const diff = useMemo(() => {
    if (!data) return { payload: {} as Record<string, unknown>, labels: [] as string[], error: null as string | null };
    const payload: Record<string, unknown> = {};
    const labels: string[] = [];
    let err: string | null = null;
    const e = data.event;

    if (form.title.trim() !== e.title) {
      if (form.title.trim().length < 2) err = 'Give the event a title.';
      payload.title = form.title.trim();
      labels.push(`Title → “${form.title.trim()}”`);
    }
    if (form.description.trim() !== (e.description ?? '')) {
      payload.description = form.description.trim() || null;
      labels.push('Description updated');
    }
    if (!data.isCinema && form.startsAt && form.startsAt !== toLocalInput(e.startsAt)) {
      const when = new Date(form.startsAt);
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) err = err ?? 'The start time needs to be in the future.';
      else {
        payload.startsAt = when.toISOString();
        labels.push(`Date & time → ${when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`);
      }
    }
    if (form.venueName.trim() !== e.venueName) {
      if (form.venueName.trim().length < 2) err = err ?? 'Enter a venue name.';
      payload.venueName = form.venueName.trim();
      labels.push(`Venue → ${form.venueName.trim()}`);
    }
    if (form.location.trim() !== (e.location ?? '')) {
      payload.location = optionalText(form.location) ?? null;
      labels.push(form.location.trim() ? `Location → ${form.location.trim()}` : 'Location deleted');
    }
    if (form.imageUrl.trim() !== (e.imageUrl ?? '')) {
      payload.imageUrl = optionalText(form.imageUrl) ?? null;
      labels.push(form.imageUrl.trim() ? 'Image updated' : 'Image deleted');
    }

    const total = Number(form.totalSeats);
    if (!form.totalSeats.trim() || !Number.isInteger(total) || total < 1 || total > MAX_SEATS_PER_EVENT) {
      err = err ?? `Total seats must be a whole number from 1 to ${MAX_SEATS_PER_EVENT}.`;
    } else if (total < data.seating.minCapacity) {
      err = err ?? `Capacity can't go below ${data.seating.minCapacity}: that many seats are already sold or held.`;
    } else if (total !== data.seating.capacity) {
      payload.totalSeats = total;
      const delta = total - data.seating.capacity;
      labels.push(`Capacity ${data.seating.capacity} → ${total} (${delta > 0 ? '+' : ''}${delta} seats)`);
    }

    const pricing: Record<string, number> = {};
    for (const tier of data.isCinema ? [] : TIERS) {
      const current = data.pricing[tier];
      if (current == null) continue; // tier has no seats
      const raw = form[tier];
      const n = Number(raw);
      if (!raw.trim() || !Number.isFinite(n) || n <= 0) {
        err = err ?? `Enter a price above zero for ${TIER_LABEL[tier]}.`;
        continue;
      }
      const paise = Math.round(n * 100);
      if (paise !== current) {
        pricing[tier] = paise;
        labels.push(`${TIER_LABEL[tier]} price ${formatINR(current)} → ${formatINR(paise)}`);
      }
    }
    if (Object.keys(pricing).length) payload.pricing = pricing;

    return { payload, labels, error: err };
  }, [data, form]);

  const affectsCustomers =
    !!data && data.seating.sold > 0 && ('startsAt' in diff.payload || 'venueName' in diff.payload || 'location' in diff.payload);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<SaveResult>(`/api/organizer/events/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...diff.payload,
          expectedUpdatedAt: data!.event.updatedAt,
          ...(acknowledged ? { confirm: true } : {}),
        }),
      }),
    onSuccess: (res) => {
      setResult(res);
      setReviewing(false);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['organizer'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      refetch().then(() => setFormReady(false));
    },
    onError: (e: unknown) => {
      const err = e as ApiError;
      if (err?.data?.code === 'CONFIRMATION_REQUIRED') setNeedsConfirm(true);
      if (err?.data?.code === 'STALE_EVENT') setStale(true);
      setFormError(err?.message || 'Could not save your changes.');
    },
  });

  if (isLoading) {
    return (
      <main className="page max-w-3xl space-y-4 py-10" aria-busy="true">
        <div className="skeleton h-12 w-72" />
        <div className="skeleton h-96" />
      </main>
    );
  }

  if (error || !data) {
    const status = error instanceof ApiError ? error.status : 0;
    const message =
      status === 403
        ? 'You can only edit events you created.'
        : status === 404
          ? 'That event does not exist.'
          : status === 401
            ? 'Sign in as an organizer to edit events.'
            : 'Something went wrong while loading this event.';
    return (
      <main className="page max-w-md space-y-4 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold">Can’t edit this event</h1>
        <p className="text-sm text-ink-2">{message}</p>
        <Link href="/organizer" className="btn btn-secondary btn-sm">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const { event, seating } = data;
  const hasChanges = Object.keys(diff.payload).length > 0;
  const field = 'field';

  const priceInput = (tier: Tier) => {
    const current = data.pricing[tier];
    const tierStats = seating.tiers.find((t) => t.tier === tier);
    return (
      <div key={tier}>
        <label className="field-label" htmlFor={`price-${tier}`}>
          {TIER_LABEL[tier]}
          {tierStats && <span className="ml-1 font-normal text-ink-3">({tierStats.total} seats)</span>}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">₹</span>
          <input
            id={`price-${tier}`}
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            disabled={current == null || !data.editable}
            value={form[tier]}
            onChange={set(tier)}
            className={`${field} pl-7 tabular-nums`}
          />
        </div>
      </div>
    );
  };

  return (
    <main className="page max-w-3xl space-y-6 py-6 pb-safe sm:py-12">
      <header className="space-y-2.5">
        <Link href="/organizer" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <div className="space-y-1.5">
          <VenueBadge type={event.venueType} />
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Edit event</h1>
          <p className="text-sm text-ink-2">
            Changes update this event in place. Tickets that were already sold keep their seats and the price they paid.
          </p>
        </div>
      </header>

      {!data.editable && (
        <p className="notice notice-warn">This event has already started or is closed, so it can no longer be edited.</p>
      )}

      {result && (
        <div className="notice notice-ok space-y-1.5" role="status">
          <p className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-4 w-4" /> Changes saved
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {result.summary.changes.length === 0 ? <li>Nothing needed to change.</li> : result.summary.changes.map((c) => <li key={c}>{c}</li>)}
            {result.summary.pricing
              .filter((p) => p.keptSoldSeats + p.keptHeldSeats > 0)
              .map((p) => (
                <li key={p.tier}>
                  {TIER_LABEL[p.tier as Tier]}: {p.keptSoldSeats} sold and {p.keptHeldSeats} currently held seat(s) kept their earlier price.
                </li>
              ))}
            {result.notifiedCustomers > 0 && <li>{result.notifiedCustomers} ticket holder(s) were emailed about the change.</li>}
          </ul>
        </div>
      )}

      {formError && (
        <div role="alert" className="notice notice-error flex flex-wrap items-center justify-between gap-2">
          <span>{formError}</span>
          {stale && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                await refetch();
                setFormReady(false);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reload latest
            </button>
          )}
        </div>
      )}

      <section className="card grid grid-cols-2 gap-3 p-4 text-center sm:grid-cols-4" aria-label="Current seating">
        {(data.isCinema
          ? [
              ['Seats per show', seating.capacity],
              ['Shows', seating.showCount],
              ['Tickets sold', seating.sold],
              ['Open seats', seating.available],
            ]
          : [
              ['Capacity', seating.capacity],
              ['Sold', seating.sold],
              ['Held now', seating.held],
              ['Open', seating.available],
            ]
        ).map(([label, value]) => (
          <div key={label as string}>
            <p className="eyebrow text-[10px]">{label}</p>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      {data.canManageShows && (
        <ShowManager
          mode="live"
          eventId={eventId}
          shows={data.shows ?? []}
          disabled={!data.editable}
          title={`Show timings (${(data.shows ?? []).length})`}
          subtitle="A cinema is scheduled by its showtimes, each with its own ticket prices. Showtime changes are saved as soon as you confirm them."
          onUpdated={() => {
            refetch();
          }}
        />
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFormError(null);
          setResult(null);
          if (diff.error) return setFormError(diff.error);
          if (!hasChanges) return setFormError('You haven’t changed anything yet.');
          setReviewing(true);
        }}
        className="card space-y-6 p-5 sm:p-6"
      >
        <fieldset disabled={!data.editable || save.isPending} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="title">Title</label>
              <input id="title" value={form.title} onChange={set('title')} maxLength={150} className={field} />
            </div>
            {!data.isCinema && (
              <div>
                <label className="field-label" htmlFor="startsAt">Starts</label>
                <input id="startsAt" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} className={field} />
              </div>
            )}
            <div>
              <label className="field-label" htmlFor="venueName">Venue name</label>
              <input id="venueName" value={form.venueName} onChange={set('venueName')} maxLength={150} className={field} />
            </div>
            <div>
              <label className="field-label" htmlFor="location">Location</label>
              <input id="location" value={form.location} onChange={set('location')} maxLength={300} placeholder="Street, area, city" className={field} />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="description">Description</label>
            <textarea id="description" value={form.description} onChange={set('description')} maxLength={5000} rows={3} className={field} />
          </div>

          <div>
            <label className="field-label" htmlFor="imageUrl">Image URL</label>
            <input id="imageUrl" type="url" value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://…" className={field} />
            {form.imageUrl.trim() && /^https?:\/\//i.test(form.imageUrl.trim()) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.imageUrl.trim()} alt="Event preview" className="mt-2 h-32 rounded-lg border border-line object-cover" />
            )}
          </div>

          <div>
            <label className="field-label" htmlFor="totalSeats">
              {data.isCinema ? 'Seats per show' : 'Total seats'}
            </label>
            <input
              id="totalSeats"
              type="number"
              min={seating.minCapacity || 1}
              max={MAX_SEATS_PER_EVENT}
              step={1}
              inputMode="numeric"
              value={form.totalSeats}
              onChange={set('totalSeats')}
              className={`${field} max-w-[200px] tabular-nums`}
            />
            <p className="mt-1.5 text-xs text-ink-3">
              {data.isCinema && 'The same seat map is used by every showtime, so seats are added to or deleted from all of them. '}
              Extra seats are added behind the last row ({seating.seatsPerRow} per row). Reducing capacity only deletes open seats from the back;
              {seating.minCapacity > 0 ? ` it can’t go below ${seating.minCapacity} while seats are sold or held.` : ' sold or held seats are never deleted.'}
            </p>
          </div>

          {!data.isCinema && (
            <div>
              <p className="field-label">Ticket prices</p>
              <div className="grid gap-4 sm:grid-cols-3">{TIERS.map(priceInput)}</div>
              <p className="mt-1.5 text-xs text-ink-3">
                New prices apply to open seats. Seats already sold, or held by a customer at this moment, keep their current price.
              </p>
            </div>
          )}
        </fieldset>

        {reviewing ? (
          <div className="space-y-3 rounded-lg border border-accent/40 bg-accent-soft/40 p-4" role="group" aria-label="Review changes">
            <p className="text-sm font-semibold">Review your changes</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {diff.labels.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {(affectsCustomers || needsConfirm) && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                <span>
                  {seating.sold} ticket{seating.sold === 1 ? ' has' : 's have'} already been sold. Their seats stay valid, and ticket holders will be emailed about
                  the date, venue or location change.
                </span>
              </label>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setReviewing(false)} disabled={save.isPending}>
                Keep editing
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={save.isPending || ((affectsCustomers || needsConfirm) && !acknowledged)}
                onClick={() => {
                  setFormError(null);
                  save.mutate();
                }}
              >
                {save.isPending ? 'Saving…' : 'Confirm and save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Link href="/organizer" className="btn btn-secondary">
              Cancel
            </Link>
            <button type="submit" disabled={!data.editable || isFetching} className="btn btn-primary">
              Review changes
            </button>
          </div>
        )}
      </form>

      {/* Danger Zone: Event Deletion */}
      <section className="card space-y-3 border-danger/30 bg-danger-soft/40 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-base text-ink">Delete this event</h3>
            <p className="text-xs text-ink-3">
              Permanently delete this event and cancel all bookings. Only the organizer who created it can delete it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="btn btn-danger btn-sm self-start sm:self-auto"
          >
            <Trash2 className="h-4 w-4" />
            Delete Event
          </button>
        </div>
      </section>

      <DeleteEventModal
        isOpen={deleteOpen}
        eventId={eventId}
        eventTitle={data.event.title}
        soldTicketsCount={data.seating.sold}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => router.push('/organizer')}
      />
    </main>
  );
}
