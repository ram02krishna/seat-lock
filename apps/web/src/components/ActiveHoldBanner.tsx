'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import { formatINR } from '@/lib/format';
import { apiFetch } from '@/lib/api';
import { useCartStore } from '@/store/cartStore';
import { useCountdown, formatClock } from '@/hooks/useCountdown';

export interface ActiveHoldInfo {
  eventId: string;
<<<<<<< HEAD
  /** Set for cinema holds: the show the seats were held for. */
  showId?: string | null;
  showStartsAt?: string | null;
=======
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
  eventTitle: string;
  venueName?: string;
  startsAt?: string;
  holdExpiresAt: string;
  seats: Array<{
    id: string;
    seatId?: string;
    section?: string;
    row: string;
    number: number;
    tier: string;
    price: number;
  }>;
  totalPrice: number;
}

interface ActiveHoldBannerProps {
  hold: ActiveHoldInfo;
  onReleased?: () => void;
}

export function ActiveHoldBanner({ hold, onReleased }: ActiveHoldBannerProps) {
  const { clearHold, restoreHold } = useCartStore();
  const [isReleasing, setIsReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the persisted cart in step with what the server says we hold, so checkout opens instantly.
  // Keyed on the hold's content, not object identity, because the query refetches on an interval.
<<<<<<< HEAD
  const holdKey = `${hold.eventId}|${hold.showId ?? ''}|${hold.holdExpiresAt}|${hold.seats.map((s) => s.id).join(',')}`;
=======
  const holdKey = `${hold.eventId}|${hold.holdExpiresAt}|${hold.seats.map((s) => s.id).join(',')}`;
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
  useEffect(() => {
    if (hold.seats.length === 0) return;
    restoreHold(
      hold.eventId,
      hold.seats.map((s) => ({
        id: s.id,
        seatId: s.seatId || s.id,
        section: s.section ?? '',
        row: s.row,
        number: s.number,
        tier: s.tier,
        price: s.price,
      })),
      hold.holdExpiresAt,
<<<<<<< HEAD
      hold.showId ?? undefined,
      hold.showStartsAt ?? undefined,
=======
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdKey, restoreHold]);

  const remaining = useCountdown(hold.holdExpiresAt, () => {
    clearHold();
    onReleased?.();
  });

  async function handleRelease() {
    setIsReleasing(true);
    setError(null);
    try {
      await apiFetch(`/api/events/${hold.eventId}/release`, {
        method: 'POST',
<<<<<<< HEAD
        body: JSON.stringify({ seatIds: hold.seats.map((s) => s.seatId || s.id), showId: hold.showId ?? undefined }),
=======
        body: JSON.stringify({ seatIds: hold.seats.map((s) => s.seatId || s.id) }),
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
      });
      clearHold();
      onReleased?.();
    } catch (err: any) {
      setError(err.message || 'Could not release the seats. Try again.');
    } finally {
      setIsReleasing(false);
    }
  }

  if (remaining === 0) return null;

  const urgent = remaining !== null && remaining < 60;
<<<<<<< HEAD
  const showQuery = hold.showId ? `&showId=${hold.showId}` : '';
=======
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
  const seatLabels = hold.seats.map((s) => `${s.row}${s.number}`).join(', ');

  return (
    <section
      aria-label="Seats on hold"
      className="card flex flex-col gap-4 border-l-[3px] border-l-accent p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="eyebrow !text-accent">Seats on hold</p>
          {remaining !== null && (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                urgent ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'
              }`}
            >
              <Clock className="h-3 w-3" />
              {formatClock(remaining)}
            </span>
          )}
        </div>
        <h3 className="truncate font-display text-lg font-semibold">{hold.eventTitle}</h3>
        <p className="text-[13px] text-ink-2">
          {hold.seats.length} seat{hold.seats.length === 1 ? '' : 's'} ({seatLabels}) ·{' '}
          <span className="font-semibold tabular-nums text-ink">{formatINR(hold.totalPrice)}</span>
        </p>
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line/60 pt-2 sm:border-0 sm:pt-0">
<<<<<<< HEAD
        <Link href={`/checkout?eventId=${hold.eventId}${showQuery}`} className="btn btn-primary btn-sm flex-1 sm:flex-initial">
          Continue to checkout
        </Link>
        <Link href={`/events/${hold.eventId}${hold.showId ? `?showId=${hold.showId}` : ''}`} className="btn btn-secondary btn-sm flex-1 sm:flex-initial">
=======
        <Link href={`/checkout?eventId=${hold.eventId}`} className="btn btn-primary btn-sm flex-1 sm:flex-initial">
          Continue to checkout
        </Link>
        <Link href={`/events/${hold.eventId}`} className="btn btn-secondary btn-sm flex-1 sm:flex-initial">
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
          View seats
        </Link>
        <button type="button" onClick={handleRelease} disabled={isReleasing} className="btn btn-ghost btn-sm">
          {isReleasing ? 'Releasing…' : 'Release'}
        </button>
      </div>
    </section>
  );
}
