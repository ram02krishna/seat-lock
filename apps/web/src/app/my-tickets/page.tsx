'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Check, Copy, MapPin, Printer, QrCode, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatINR, formatEventDateTime } from '@/lib/format';

interface TicketItem {
  id: string;
  qrToken: string;
  checkedInAt: string | null;
  seat: { section: string; row: string; number: number; tier: string };
  price: number;
  qrDataUrl: string;
}

interface OrderItem {
  id: string;
  totalCents: number;
  createdAt: string;
  event: { id: string; title: string; startsAt: string; location?: string | null; venue: { name: string } };
  show?: { id: string; startsAt: string } | null;
  tickets: TicketItem[];
}

interface Enlarged {
  qrDataUrl: string;
  qrToken: string;
  seatLabel: string;
  eventTitle: string;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

function ConfirmedNotice() {
  const params = useSearchParams();
  if (params.get('confirmed') !== '1') return null;
  return (
    <p className="notice notice-ok no-print">
      <Check className="mt-0.5 h-4 w-4 shrink-0" />
      <span>You’re booked. Your tickets are below, and a copy is on its way to your inbox.</span>
    </p>
  );
}

function TicketCard({
  ticket,
  onEnlarge,
  onCopy,
  copied,
}: {
  ticket: TicketItem;
  onEnlarge: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const used = !!ticket.checkedInAt;
  return (
    <li className="ticket-card flex overflow-hidden rounded-lg border border-line bg-bg print:border-gray-300 print:bg-white">
      <div className="group relative m-2.5 sm:m-3 shrink-0 self-start rounded-md bg-white p-1 sm:p-1.5 ring-1 ring-black/10 transition hover:ring-accent print:ring-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ticket.qrDataUrl}
          alt=""
          className={`h-[76px] w-[76px] sm:h-[88px] sm:w-[88px] print:h-[96px] print:w-[96px] ${used ? 'opacity-30 print:opacity-40' : ''}`}
        />
        <button
          type="button"
          onClick={onEnlarge}
          className="no-print absolute inset-0 flex items-center justify-center rounded-md bg-black/0 text-transparent transition group-hover:bg-black/55 group-hover:text-white"
          aria-label={`Enlarge QR code for row ${ticket.seat.row}, seat ${ticket.seat.number}`}
        >
          <QrCode className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between border-l border-dashed border-line-strong py-2.5 pl-3 pr-2.5 sm:py-3 sm:pl-4 sm:pr-3 print:border-gray-300">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow text-[10px] sm:text-[11px] capitalize print:text-gray-700 print:font-bold">
              {ticket.seat.tier.toLowerCase()}
            </span>
            <span className={`text-[11px] sm:text-xs font-semibold ${used ? 'text-ink-3 print:text-gray-500' : 'text-ok print:text-green-700'}`}>
              {used ? 'Used' : 'Valid Entry'}
            </span>
          </div>
          <p className="mt-0.5 sm:mt-1 font-display text-base sm:text-xl font-semibold leading-tight print:text-gray-900">
            Row {ticket.seat.row}, seat {ticket.seat.number}
          </p>
          <p className="text-xs tabular-nums text-ink-3 font-medium print:text-gray-700">{formatINR(ticket.price)}</p>
          <p className="hidden print:block text-[10px] font-mono text-gray-500 mt-1">
            Pass: {ticket.qrToken.slice(0, 16).toUpperCase()}
          </p>
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="no-print mt-2 sm:mt-3 inline-flex items-center gap-1.5 self-start text-xs font-medium text-ink-2 hover:text-accent"
          title="Copy the ticket code, handy if the QR won’t scan"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy ticket code'}
        </button>
      </div>
    </li>
  );
}

function OrderBlock({
  order,
  isPrinting,
  onPrint,
  onEnlarge,
  onCopy,
  copiedId,
}: {
  order: OrderItem;
  isPrinting: boolean;
  onPrint: (orderId: string) => void;
  onEnlarge: (t: TicketItem, order: OrderItem) => void;
  onCopy: (t: TicketItem) => void;
  copiedId: string | null;
}) {
  return (
    <article
      className="order-card card overflow-hidden print:border-gray-300 print:shadow-none"
      data-order-id={order.id}
      data-order-printing={isPrinting ? 'true' : 'false'}
    >
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 border-b border-line p-4 sm:p-5 print:border-gray-200 print:p-4">
        <div className="space-y-1 sm:space-y-1.5 min-w-0">
          <div className="hidden print:flex items-center gap-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            <span>SeatLock Official Gate Pass</span>
            <span>•</span>
            <span className="text-green-700 font-bold">Confirmed Booking</span>
          </div>
          <h3 className="break-words font-display text-xl sm:text-2xl font-semibold leading-tight tracking-tight print:text-2xl print:text-gray-900">
            {order.event.title}
          </h3>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-[13px] text-ink-2 print:text-gray-700">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink print:text-gray-900">
              <Calendar className="h-3.5 w-3.5 text-accent shrink-0 print:text-gray-900" />
              {order.show?.startsAt
                ? `Showtime: ${formatEventDateTime(order.show.startsAt)}`
                : formatEventDateTime(order.event.startsAt)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-ink-3 shrink-0 print:text-gray-900" />
              <span className="font-semibold text-ink print:text-gray-900">{order.event.venue.name}</span>
              {order.event.location ? (
                <>
                  <span className="text-ink-4 print:text-gray-400">·</span>
                  <span>{order.event.location}</span>
                </>
              ) : null}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:block sm:text-right border-t border-line/60 pt-2 sm:border-0 sm:pt-0 print:border-0 print:pt-0">
          <div>
            <p className="text-base sm:text-lg font-semibold tabular-nums print:text-gray-900">{formatINR(order.totalCents)}</p>
            <p className="text-[11px] sm:text-xs text-ink-3 print:text-gray-600">
              Order #{order.id.slice(0, 8).toUpperCase()} · {new Date(order.createdAt).toLocaleDateString('en-IN')}
            </p>
          </div>
          <div className="no-print mt-1.5 sm:mt-2">
            <button
              type="button"
              onClick={() => onPrint(order.id)}
              className="btn btn-secondary btn-xs inline-flex items-center gap-1.5 font-medium hover:border-accent hover:text-accent"
              title="Print tickets for this event only"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print ticket{order.tickets.length > 1 ? 's' : ''}</span>
            </button>
          </div>
        </div>
      </header>

      <ul className="grid gap-2.5 sm:gap-3 p-3.5 sm:p-4 sm:grid-cols-2 print:grid-cols-2 print:gap-3">
        {order.tickets.map((t) => (
          <TicketCard
            key={t.id}
            ticket={t}
            copied={copiedId === t.id}
            onEnlarge={() => onEnlarge(t, order)}
            onCopy={() => onCopy(t)}
          />
        ))}
      </ul>

      <footer className="hidden print:flex items-center justify-between border-t border-gray-200 p-3 text-[11px] text-gray-500 bg-gray-50">
        <span>Total Tickets: {order.tickets.length}</span>
        <span>Please carry a valid photo ID • Single entry scan at gate</span>
        <span>seatlock.com</span>
      </footer>
    </article>
  );
}

export default function MyTicketsPage() {
  const { data: authData, isLoading: authLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch('/api/auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const user = authData?.user;

  const { data, isLoading, isError, refetch } = useQuery<{ orders: OrderItem[] }>({
    queryKey: ['my-tickets'],
    queryFn: () => apiFetch('/api/orders/my-tickets'),
    enabled: !!user,
    retry: false,
    staleTime: 30000,
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<Enlarged | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);

  const handlePrint = (orderId: string) => {
    setPrintingOrderId(orderId);
    if (typeof document !== 'undefined') {
      document.body.setAttribute('data-printing-order', orderId);
    }
    setTimeout(() => {
      window.print();
    }, 80);
  };

  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintingOrderId(null);
      if (typeof document !== 'undefined') {
        document.body.removeAttribute('data-printing-order');
      }
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      if (typeof document !== 'undefined') {
        document.body.removeAttribute('data-printing-order');
      }
    };
  }, []);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const orders = data?.orders ?? [];
    const isPast = (o: OrderItem) => new Date(o.event.startsAt).getTime() + SIX_HOURS < now;
    return {
      upcoming: orders
        .filter((o) => !isPast(o))
        .sort((a, b) => new Date(a.event.startsAt).getTime() - new Date(b.event.startsAt).getTime()),
      past: orders.filter(isPast),
    };
  }, [data]);

  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setEnlarged(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);

  async function copyToken(token: string, id: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      // Clipboard blocked (insecure context); the code is still visible in the QR dialog
    }
  }

  const handleEnlarge = (t: TicketItem, order: OrderItem) =>
    setEnlarged({
      qrDataUrl: t.qrDataUrl,
      qrToken: t.qrToken,
      seatLabel: `Row ${t.seat.row}, seat ${t.seat.number}`,
      eventTitle: order.event.title,
    });

  const hasOrders = upcoming.length + past.length > 0;
  const loading = authLoading || (!!user && isLoading);

  return (
    <main className="page max-w-4xl space-y-8 py-8 sm:py-14 pb-safe">
      <header className="flex flex-wrap items-end justify-between gap-4 no-print">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">My tickets</h1>
          <p className="text-[15px] text-ink-2">Show the QR code at the door. Staff scan it once.</p>
        </div>
      </header>

      <Suspense fallback={null}>
        <ConfirmedNotice />
      </Suspense>

      {loading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="skeleton h-52" />
          <div className="skeleton h-52" />
        </div>
      ) : !user ? (
        <div className="card mx-auto max-w-sm space-y-4 p-8 text-center">
          <h2 className="font-display text-xl font-semibold">Sign in to see your tickets</h2>
          <p className="text-sm text-ink-2">Tickets live on your account, so they’re safe if you switch devices.</p>
          <Link href="/login?redirect=/my-tickets" className="btn btn-primary w-full">
            Sign in
          </Link>
        </div>
      ) : isError ? (
        <div className="card space-y-3 p-8 text-center">
          <p className="font-display text-xl font-semibold">We couldn’t load your tickets</p>
          <button type="button" onClick={() => refetch()} className="btn btn-secondary btn-sm">
            Try again
          </button>
        </div>
      ) : !hasOrders ? (
        <div className="card space-y-3 p-10 text-center">
          <p className="font-display text-xl font-semibold">No tickets yet</p>
          <p className="text-sm text-ink-2">When you book seats, they’ll show up here.</p>
          <Link href="/" className="btn btn-primary btn-sm mt-1">
            Browse events
          </Link>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-4" aria-label="Upcoming">
              {past.length > 0 && <h2 className="eyebrow no-print">Upcoming</h2>}
              {upcoming.map((o) => (
                <OrderBlock
                  key={o.id}
                  order={o}
                  isPrinting={printingOrderId === o.id}
                  onPrint={handlePrint}
                  onEnlarge={handleEnlarge}
                  onCopy={(t) => copyToken(t.qrToken, t.id)}
                  copiedId={copiedId}
                />
              ))}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-4" aria-label="Past events">
              <h2 className="eyebrow no-print">Past events</h2>
              {past.map((o) => (
                <OrderBlock
                  key={o.id}
                  order={o}
                  isPrinting={printingOrderId === o.id}
                  onPrint={handlePrint}
                  onEnlarge={handleEnlarge}
                  onCopy={(t) => copyToken(t.qrToken, t.id)}
                  copiedId={copiedId}
                />
              ))}
            </section>
          )}
        </>
      )}

      {enlarged && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`QR code for ${enlarged.seatLabel}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm"
          onClick={() => setEnlarged(null)}
        >
          <div
            className="relative w-full max-w-sm space-y-3.5 sm:space-y-4 rounded-2xl bg-surface p-4 sm:p-6 text-center shadow-lift max-h-[92dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setEnlarged(null)}
              className="absolute right-3 top-3 rounded-md p-1.5 text-ink-3 hover:bg-sunken hover:text-ink min-h-[36px] min-w-[36px] flex items-center justify-center"
              aria-label="Close"
              autoFocus
            >
              <X className="h-5 w-5" />
            </button>
            <div className="space-y-0.5 pt-1 sm:pt-2">
              <p className="font-display text-lg sm:text-xl font-semibold">{enlarged.eventTitle}</p>
              <p className="text-sm font-medium text-accent">{enlarged.seatLabel}</p>
            </div>
            <div className="mx-auto inline-block rounded-xl bg-white p-2 sm:p-3 ring-1 ring-black/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enlarged.qrDataUrl} alt="Ticket QR code" className="h-48 w-48 sm:h-60 sm:w-60 max-w-full aspect-square" />
            </div>
            <p className="text-xs text-ink-3">Hold your screen brightness up and show this to the scanner at the gate.</p>
          </div>
        </div>
      )}
    </main>
  );
}
