'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatINR, formatEventDateTime } from '@/lib/format';
import { VenueBadge, VENUE_LABELS, VenueTypeKey } from '@/components/venue-badge';
import { MAX_SEATS_PER_EVENT, MAX_SEATS_PER_ROW, optionalText, parseCount, previewSeating } from '@/lib/seating';

const PRESETS: Record<VenueTypeKey, { venue: string; vip: string; premium: string; standard: string; blurb: string }> = {
  THEATER_DOLBY: { venue: 'Dolby Atmos Cinema', vip: '1200', premium: '700', standard: '400', blurb: 'Curved screen, recliners up front, centre aisle.' },
  CONFERENCE_HALL: { venue: 'Convention Centre Hall', vip: '2500', premium: '1500', standard: '800', blurb: 'Keynote stage with delegate rows.' },
  AUDITORIUM: { venue: 'Grand Auditorium', vip: '2800', premium: '1750', standard: '850', blurb: 'Curved rows facing a proscenium stage.' },
  ARENA: { venue: 'Concert Arena', vip: '3500', premium: '2000', standard: '950', blurb: 'Thrust stage with a runway through the front pit.' },
  OTHERS: { venue: 'Multipurpose Hall', vip: '2000', premium: '1200', standard: '600', blurb: 'Simple flexible layout for talks and shows.' },
};

interface EventStat {
  id: string;
  title: string;
  startsAt: string;
  venueName: string;
  venueType?: string;
  totalSeats: number;
  soldSeats: number;
  heldSeats: number;
  availableSeats: number;
  occupancyRate: number;
  revenueCents: number;
}

interface DashboardData {
  summary: {
    totalEvents: number;
    totalVenues: number;
    totalTicketsSold: number;
    totalRevenueCents: number;
    totalSeats: number;
    overallOccupancyRate: number;
  };
  events: EventStat[];
  recentOrders: Array<{
    id: string;
    userEmail: string;
    eventTitle: string;
    ticketCount: number;
    totalCents: number;
    createdAt: string;
  }>;
}

interface StaffMember {
  id: string;
  email: string;
  createdAt: string;
}

/** `<input type="datetime-local">` wants local time, not UTC */
function localNowForInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function rupeesToPaise(value: string, label: string): number {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n <= 0) throw new Error(`Enter a price above zero for ${label}.`);
  return Math.round(n * 100);
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-3 sm:p-5 min-w-0 overflow-hidden">
      <p className="eyebrow text-[10px] sm:text-[11px] truncate">{label}</p>
      <p className="mt-1 sm:mt-2 text-lg sm:text-3xl font-semibold tabular-nums tracking-tight break-all">{value}</p>
      {hint && <p className="mt-1 text-[11px] sm:text-xs text-ink-3 truncate">{hint}</p>}
    </div>
  );
}

function CreateEventForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [venueType, setVenueType] = useState<VenueTypeKey>('THEATER_DOLBY');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [venueName, setVenueName] = useState(PRESETS.THEATER_DOLBY.venue);
  const [startsAt, setStartsAt] = useState('');
  const [location, setLocation] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [totalSeats, setTotalSeats] = useState('60');
  const [seatsPerRow, setSeatsPerRow] = useState('');
  const [vipSeats, setVipSeats] = useState('');
  const [premiumSeats, setPremiumSeats] = useState('');
  const [vip, setVip] = useState(PRESETS.THEATER_DOLBY.vip);
  const [premium, setPremium] = useState(PRESETS.THEATER_DOLBY.premium);
  const [standard, setStandard] = useState(PRESETS.THEATER_DOLBY.standard);
  const [error, setError] = useState<string | null>(null);

  const seating = previewSeating(totalSeats, seatsPerRow, vipSeats, premiumSeats);

  function pickType(type: VenueTypeKey) {
    const wasDefaultName = Object.values(PRESETS).some((p) => p.venue === venueName.trim()) || !venueName.trim();
    setVenueType(type);
    if (wasDefaultName) setVenueName(PRESETS[type].venue);
    setVip(PRESETS[type].vip);
    setPremium(PRESETS[type].premium);
    setStandard(PRESETS[type].standard);
  }

  const create = useMutation({
    mutationFn: async () => {
      if (title.trim().length < 2) throw new Error('Give the event a title.');
      if (!venueName.trim()) throw new Error('Enter a venue name.');
      if (!startsAt) throw new Error('Pick a start date and time.');
      if (seating.error || !seating.preview) throw new Error(seating.error || 'Check the seating numbers.');
      const when = new Date(startsAt);
      if (when.getTime() <= Date.now()) throw new Error('The start time needs to be in the future.');

      const pricing = {
        VIP: rupeesToPaise(vip, 'VIP'),
        PREMIUM: rupeesToPaise(premium, 'Premium'),
        STANDARD: rupeesToPaise(standard, 'Standard'),
      };

      return apiFetch('/api/organizer/events', {
        method: 'POST',
        body: JSON.stringify({
          venueName: venueName.trim(),
          venueType,
          title: title.trim(),
          description: description.trim() || undefined,
          startsAt: when.toISOString(),
          location: optionalText(location),
          imageUrl: optionalText(imageUrl),
          pricing,
          totalSeats: parseCount(totalSeats),
          seatsPerRow: parseCount(seatsPerRow),
          vipSeats: parseCount(vipSeats),
          premiumSeats: parseCount(premiumSeats),
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      onDone();
    },
    onError: (e: any) => setError(e.message || 'Could not create the event.'),
  });

  const priceInput = (label: string, value: string, set: (v: string) => void) => (
    <div>
      <label className="field-label">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">₹</span>
        <input type="number" min={1} step="any" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} className="field pl-7 tabular-nums" />
      </div>
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate();
      }}
      className="card space-y-6 p-5 sm:p-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">New event</h2>
        <button type="button" onClick={onDone} className="btn btn-ghost !p-2" aria-label="Close form">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}

      <fieldset>
        <legend className="field-label">Seating layout</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PRESETS) as VenueTypeKey[]).map((type) => (
            <label
              key={type}
              className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                venueType === type ? 'border-accent bg-accent-soft/50' : 'border-line-strong hover:bg-sunken'
              }`}
            >
              <input type="radio" name="layout" className="sr-only" checked={venueType === type} onChange={() => pickType(type)} />
              <span className="block text-sm font-semibold">{VENUE_LABELS[type]}</span>
              <span className="mt-0.5 block text-xs text-ink-3">{PRESETS[type].blurb}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="field-label">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
        </div>
        <div>
          <label className="field-label">Venue name</label>
          <input value={venueName} onChange={(e) => setVenueName(e.target.value)} className="field" />
        </div>
        <div>
          <label className="field-label">Starts</label>
          <input type="datetime-local" min={localNowForInput()} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="field" />
        </div>
        <div>
          <label className="field-label">
            Description <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="field" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="field-label">
            Location <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="Street, area, city" className="field" />
        </div>
        <div>
          <label className="field-label">
            Image URL <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" className="field" />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="field-label">Seating capacity</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="total-seats">Total seats</label>
            <input id="total-seats" type="number" min={1} max={MAX_SEATS_PER_EVENT} step={1} inputMode="numeric" value={totalSeats} onChange={(e) => setTotalSeats(e.target.value)} className="field tabular-nums" />
          </div>
          <div>
            <label className="field-label" htmlFor="seats-per-row">Seats per row <span className="font-normal text-ink-3">(auto)</span></label>
            <input id="seats-per-row" type="number" min={1} max={MAX_SEATS_PER_ROW} step={1} inputMode="numeric" value={seatsPerRow} onChange={(e) => setSeatsPerRow(e.target.value)} placeholder={seating.preview ? String(seating.preview.seatsPerRow) : ''} className="field tabular-nums" />
          </div>
          <div>
            <label className="field-label" htmlFor="vip-seats">VIP seats <span className="font-normal text-ink-3">(auto)</span></label>
            <input id="vip-seats" type="number" min={0} step={1} inputMode="numeric" value={vipSeats} onChange={(e) => setVipSeats(e.target.value)} placeholder={seating.preview ? String(seating.preview.vip) : ''} className="field tabular-nums" />
          </div>
          <div>
            <label className="field-label" htmlFor="premium-seats">Premium seats <span className="font-normal text-ink-3">(auto)</span></label>
            <input id="premium-seats" type="number" min={0} step={1} inputMode="numeric" value={premiumSeats} onChange={(e) => setPremiumSeats(e.target.value)} placeholder={seating.preview ? String(seating.preview.premium) : ''} className="field tabular-nums" />
          </div>
        </div>
        {seating.error ? (
          <p className="text-xs text-danger">{seating.error}</p>
        ) : (
          seating.preview && (
            <p className="text-xs text-ink-3 tabular-nums">
              The seat map will have {totalSeats} seats in {seating.preview.rows} rows: {seating.preview.vip} VIP · {seating.preview.premium} Premium · {seating.preview.standard} Standard. Leave a field blank to let us choose.
            </p>
          )
        )}
      </fieldset>

      <div>
        <p className="field-label">Ticket prices</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {priceInput('VIP', vip, setVip)}
          {priceInput('Premium', premium, setPremium)}
          {priceInput('Standard', standard, setStandard)}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={create.isPending} className="btn btn-primary">
          {create.isPending ? 'Publishing…' : 'Publish event'}
        </button>
      </div>
    </form>
  );
}

function StaffSection() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ staff: StaffMember[] }>({
    queryKey: ['organizer', 'staff'],
    queryFn: () => apiFetch('/api/organizer/staff'),
  });

  const create = useMutation({
    mutationFn: () => {
      if (password.length < 6) throw new Error('Passwords need at least 6 characters.');
      return apiFetch('/api/organizer/staff', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer', 'staff'] });
      setOk(`${email.trim()} can now sign in and scan tickets.`);
      setEmail('');
      setPassword('');
      setError(null);
    },
    onError: (e: any) => {
      setOk(null);
      setError(e.message || 'Could not create the account.');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/organizer/staff/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizer', 'staff'] }),
  });

  const staff = data?.staff ?? [];

  return (
    <section className="space-y-4" aria-labelledby="staff-heading">
      <div>
        <h2 id="staff-heading" className="font-display text-2xl font-semibold">
          Gate staff
        </h2>
        <p className="text-sm text-ink-2">Staff accounts can scan tickets at <Link href="/staff/scanner" className="underline">the scanner</Link>, and nothing else.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setOk(null);
            setError(null);
            create.mutate();
          }}
          className="card space-y-4 p-5"
        >
          {error && <p role="alert" className="notice notice-error">{error}</p>}
          {ok && <p className="notice notice-ok">{ok}</p>}
          <div>
            <label className="field-label">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field" autoComplete="off" />
          </div>
          <div>
            <label className="field-label">Temporary password</label>
            <div className="relative">
              <input type={show ? 'text' : 'password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="field pr-11" autoComplete="new-password" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-3 hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={create.isPending} className="btn btn-primary w-full">
            {create.isPending ? 'Creating…' : 'Create staff account'}
          </button>
        </form>

        <div className="card divide-y divide-line">
          {isLoading ? (
            <div className="skeleton m-4 h-16" />
          ) : staff.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-3">No staff accounts yet.</p>
          ) : (
            staff.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.email}</p>
                  <p className="text-xs text-ink-3">Added {new Date(m.createdAt).toLocaleDateString('en-IN')}</p>
                </div>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => confirm(`Remove scanner access for ${m.email}?`) && remove.mutate(m.id)}
                  className="btn btn-ghost btn-sm text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export default function OrganizerDashboardPage() {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: authData, isLoading: authLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch('/api/auth/me'),
    retry: false,
  });
  const isOrganizer = authData?.user?.role === 'ORGANIZER';

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['organizer', 'stats'],
    queryFn: () => apiFetch('/api/organizer/stats'),
    enabled: isOrganizer,
    refetchInterval: 15000,
  });

  if (authLoading) {
    return (
      <main className="page max-w-6xl py-12" aria-busy="true">
        <div className="skeleton h-64" />
      </main>
    );
  }

  if (!isOrganizer) {
    return (
      <main className="page max-w-md space-y-4 py-24 text-center">
        <h1 className="font-display text-3xl font-semibold">Organizer area</h1>
        <p className="text-sm text-ink-2">Sales, occupancy and staff management are available to organizer accounts.</p>
        <Link href="/login?redirect=/organizer" className="btn btn-primary btn-sm">
          Sign in
        </Link>
      </main>
    );
  }

  const summary = data?.summary;
  const q = search.trim().toLowerCase();
  const events = (data?.events ?? []).filter((e) => !q || e.title.toLowerCase().includes(q) || e.venueName.toLowerCase().includes(q));

  return (
    <main className="page max-w-6xl space-y-8 sm:space-y-10 py-6 sm:py-12 pb-safe">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm sm:text-[15px] text-ink-2">Sales and seat occupancy, refreshed every few seconds.</p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className="btn btn-primary self-start sm:self-auto">
            <Plus className="h-4 w-4" />
            New event
          </button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={isLoading ? '–' : formatINR(summary?.totalRevenueCents ?? 0)} hint="Confirmed orders" />
        <Stat label="Tickets sold" value={isLoading ? '–' : summary?.totalTicketsSold ?? 0} hint={`of ${summary?.totalSeats ?? 0} seats`} />
        <Stat label="Occupancy" value={isLoading ? '–' : `${summary?.overallOccupancyRate ?? 0}%`} hint="Across all events" />
        <Stat label="Events" value={isLoading ? '–' : summary?.totalEvents ?? 0} hint={`${summary?.totalVenues ?? 0} venues`} />
      </div>

      {creating && <CreateEventForm onDone={() => setCreating(false)} />}

      <section className="space-y-4" aria-labelledby="events-heading">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <h2 id="events-heading" className="font-display text-xl sm:text-2xl font-semibold">
            Events
          </h2>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events or venues" className="field pl-9" aria-label="Search events" />
          </div>
        </div>

        {isLoading ? (
          <div className="skeleton h-40" />
        ) : events.length === 0 ? (
          <p className="card p-6 sm:p-8 text-center text-sm text-ink-3">{data?.events.length ? 'No events match your search.' : 'No events yet. Create the first one.'}</p>
        ) : (
          <div className="card divide-y divide-line">
            {events.map((ev) => (
              <div key={ev.id} className="grid gap-3 sm:gap-4 p-4 sm:p-5 md:grid-cols-[1fr_220px_150px] md:items-center">
                <div className="min-w-0 space-y-1.5">
                  <VenueBadge type={ev.venueType} />
                  <Link href={`/organizer/events/${ev.id}`} className="block truncate font-display text-lg sm:text-xl font-semibold hover:text-accent">
                    {ev.title}
                  </Link>
                  <p className="truncate text-xs sm:text-[13px] text-ink-3">
                    {ev.venueName} · {formatEventDateTime(ev.startsAt)}
                  </p>
                </div>

                <div className="space-y-1.5 border-t border-line/60 pt-2.5 md:border-0 md:pt-0">
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${ev.soldSeats} sold, ${ev.heldSeats} held, ${ev.availableSeats} available`}>
                    <div className="bg-accent" style={{ width: `${ev.totalSeats ? (ev.soldSeats / ev.totalSeats) * 100 : 0}%` }} />
                    <div className="bg-warn/60" style={{ width: `${ev.totalSeats ? (ev.heldSeats / ev.totalSeats) * 100 : 0}%` }} />
                  </div>
                  <p className="text-[11px] sm:text-xs tabular-nums text-ink-3">
                    {ev.soldSeats} sold · {ev.heldSeats} held · {ev.availableSeats} open
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 md:block md:text-right border-t border-line/60 pt-2 md:border-0 md:pt-0">
                  <p className="font-semibold tabular-nums text-sm sm:text-base">{formatINR(ev.revenueCents)}</p>
                  <div className="flex items-center gap-3 md:justify-end">
                    <Link href={`/organizer/events/${ev.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Link>
                    <Link href={`/events/${ev.id}`} className="text-xs text-ink-3 underline hover:text-ink">
                      Public page
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="orders-heading">
        <h2 id="orders-heading" className="font-display text-xl sm:text-2xl font-semibold">
          Recent orders
        </h2>
        {(data?.recentOrders ?? []).length === 0 ? (
          <p className="card p-6 sm:p-8 text-center text-sm text-ink-3">Orders will appear here as they come in.</p>
        ) : (
          <>
            {/* Mobile order cards */}
            <div className="card divide-y divide-line sm:hidden">
              {data!.recentOrders.map((o) => (
                <div key={o.id} className="p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink truncate max-w-[180px]">{o.userEmail}</span>
                    <span className="font-semibold tabular-nums text-ink">{formatINR(o.totalCents)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-ink-3">
                    <span className="truncate max-w-[200px]">{o.eventTitle}</span>
                    <span>{o.ticketCount} ticket{o.ticketCount === 1 ? '' : 's'}</span>
                  </div>
                  <p className="text-[11px] text-ink-3">
                    {new Date(o.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="card overflow-x-auto hidden sm:block">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-line text-xs text-ink-3">
                  <tr>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-3 py-3 font-medium">Event</th>
                    <th className="px-3 py-3 text-right font-medium">Tickets</th>
                    <th className="px-3 py-3 text-right font-medium">Total</th>
                    <th className="px-5 py-3 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data!.recentOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="max-w-[200px] truncate px-5 py-3">{o.userEmail}</td>
                      <td className="max-w-[220px] truncate px-3 py-3 text-ink-2">{o.eventTitle}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{o.ticketCount}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{formatINR(o.totalCents)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-ink-3">
                        {new Date(o.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <StaffSection />
    </main>
  );
}
