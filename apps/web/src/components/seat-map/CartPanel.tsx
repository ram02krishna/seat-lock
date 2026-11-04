'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, Clock, X } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { apiFetch } from '@/lib/api';
import { formatINR, formatEventDateTime } from '@/lib/format';
import { useCountdown, formatClock } from '@/hooks/useCountdown';

interface CartPanelProps {
  eventId: string;
  showId?: string | null;
  showStartsAt?: string | null;
  /** Called after anything that may have changed seat availability, so the map can refetch */
  onHoldSuccess?: () => void;
  onReleaseSuccess?: () => void;
}

export function CartPanel({ eventId, showId, showStartsAt, onHoldSuccess, onReleaseSuccess }: CartPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedSeats, heldSeatIds, holdExpiresAt, toggleSeat, clearSelection, setHeldSeats, clearHold } =
    useCartStore();

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { data: authData } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch('/api/auth/me'),
    retry: false,
  });
  const signedIn = !!authData?.user;

  const isHeld = heldSeatIds.length > 0 && !!holdExpiresAt;
  const total = selectedSeats.reduce((sum, s) => sum + s.price, 0);
  const loginRedirect = showId ? `/events/${eventId}?showId=${showId}` : `/events/${eventId}`;
  const loginHref = `/login?redirect=${encodeURIComponent(loginRedirect)}`;

  const remaining = useCountdown(isHeld ? holdExpiresAt : null, () => {
    clearHold();
    setMessage('Your hold ran out and the seats were released.');
    onReleaseSuccess?.();
  });
  const urgent = remaining !== null && remaining < 60;

  function patchSeatCache(status: 'HELD' | 'AVAILABLE', expiresAt: string | null) {
    const ids = new Set(selectedSeats.map((s) => s.id));
    const rawIds = new Set(selectedSeats.map((s) => s.seatId));
    queryClient.setQueryData(['events', eventId, 'seats', showId || 'default'], (old: any) => {
      if (!old?.seats) return old;
      return {
        ...old,
        seats: old.seats.map((seat: any) =>
          ids.has(seat.id) || rawIds.has(seat.seatId)
            ? { ...seat, status, isHeldByMe: status === 'HELD', holdExpiresAt: expiresAt }
            : seat,
        ),
      };
    });
    // Also patch default key if any
    queryClient.setQueryData(['events', eventId, 'seats'], (old: any) => {
      if (!old?.seats) return old;
      return {
        ...old,
        seats: old.seats.map((seat: any) =>
          ids.has(seat.id) || rawIds.has(seat.seatId)
            ? { ...seat, status, isHeldByMe: status === 'HELD', holdExpiresAt: expiresAt }
            : seat,
        ),
      };
    });
  }

  async function handleHold() {
    if (selectedSeats.length === 0) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/events/${eventId}/hold`, {
        method: 'POST',
        body: JSON.stringify({
          seatIds: selectedSeats.map((s) => s.seatId),
          showId: showId || undefined,
        }),
      });
      patchSeatCache('HELD', res.holdExpiresAt);
      setHeldSeats(
        selectedSeats.map((s) => s.id),
        res.holdExpiresAt,
        eventId,
        showId || undefined,
      );
      setNeedsSignIn(false);
      onHoldSuccess?.();
    } catch (err: any) {
      if (err.status === 401) {
        setNeedsSignIn(true);
        setMessage('Sign in to hold seats. Your selection will be waiting for you.');
      } else {
        setNeedsSignIn(false);
        setMessage(err.message || 'Could not hold those seats.');
        // Most failures here mean availability changed under us
        onReleaseSuccess?.();
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRelease() {
    setIsLoading(true);
    setMessage(null);
    try {
      const seatIds =
        selectedSeats.length > 0
          ? selectedSeats.map((s) => s.seatId || s.id)
          : heldSeatIds;
      await apiFetch(`/api/events/${eventId}/release`, {
        method: 'POST',
        body: JSON.stringify({ seatIds, showId: showId || undefined }),
      });
      patchSeatCache('AVAILABLE', null);
      clearHold();
      onReleaseSuccess?.();
    } catch (err: any) {
      setMessage(err.message || 'Could not release the seats.');
    } finally {
      setIsLoading(false);
    }
  }

  const empty = selectedSeats.length === 0 && !isHeld;

  useEffect(() => {
    if (empty) setExpanded(false);
  }, [empty]);

  const seatList = (
    <ul className="divide-y divide-line">
      {selectedSeats.map((seat) => (
        <li key={seat.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="font-medium">
              Row {seat.row}, seat {seat.number}
            </p>
            <p className="text-xs capitalize text-ink-3">{seat.tier.toLowerCase()}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">{formatINR(seat.price)}</span>
            {!isHeld && (
              <button
                type="button"
                onClick={() => toggleSeat(seat)}
                className="rounded-md p-1 text-ink-3 hover:bg-sunken hover:text-danger"
                aria-label={`Delete row ${seat.row} seat ${seat.number}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  const checkoutUrl = showId
    ? `/checkout?eventId=${eventId}&showId=${showId}`
    : `/checkout?eventId=${eventId}`;

  const primaryAction = isHeld ? (
    <button type="button" onClick={() => router.push(checkoutUrl)} className="btn btn-primary w-full">
      <span className="hidden sm:inline">Continue to checkout</span>
      <span className="sm:hidden">Checkout</span>
    </button>
  ) : needsSignIn || !signedIn ? (
    <Link href={loginHref} className="btn btn-primary w-full">
      <span className="hidden sm:inline">Sign in to hold seats</span>
      <span className="sm:hidden">Sign in</span>
    </Link>
  ) : (
    <button type="button" onClick={handleHold} disabled={isLoading || selectedSeats.length === 0} className="btn btn-primary w-full">
      {isLoading ? (
        'Holding…'
      ) : (
        <>
          <span className="hidden sm:inline">Hold seats for 5 mins</span>
          <span className="sm:hidden">Hold seats</span>
        </>
      )}
    </button>
  );

  const messageBlock = message && (
    <p role="alert" className={`notice ${needsSignIn ? 'notice-warn' : 'notice-error'}`}>
      {message}
    </p>
  );

  return (
    <>
      {/* Desktop: sticky sidebar */}
      <aside className="card hidden self-start p-5 lg:sticky lg:top-20 lg:block" aria-label="Your seats">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-semibold">{isHeld ? 'Seats on hold' : 'Your seats'}</h2>
          <span className="text-xs tabular-nums text-ink-3">{selectedSeats.length} of 6</span>
        </div>
        {showStartsAt && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-2 font-medium">
            <Clock className="h-3.5 w-3.5 text-accent shrink-0" />
            <span>Show: {formatEventDateTime(showStartsAt)}</span>
          </div>
        )}

        {isHeld && remaining !== null && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium ${
              urgent ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>
              Yours for <span className="tabular-nums">{formatClock(remaining)}</span>
            </span>
          </div>
        )}

        {empty ? (
          <p className="py-8 text-center text-sm text-ink-3">
            Choose seats on the map.
            <br />
            You can book up to six at a time.
          </p>
        ) : (
          <>
            <div className="mt-2">{seatList}</div>
            <div className="mt-2 flex items-baseline justify-between border-t border-line-strong pt-4">
              <span className="text-sm text-ink-2">Total</span>
              <span className="text-2xl font-semibold tabular-nums">{formatINR(total)}</span>
            </div>
            <div className="mt-4 space-y-3">
              {messageBlock}
              {primaryAction}
              {isHeld ? (
                <button type="button" onClick={handleRelease} disabled={isLoading} className="btn btn-ghost btn-sm w-full">
                  Release these seats
                </button>
              ) : (
                <button type="button" onClick={clearSelection} className="btn btn-ghost btn-sm w-full">
                  Clear selection
                </button>
              )}
            </div>
          </>
        )}
        {empty && message && <div className="mt-2">{messageBlock}</div>}
      </aside>

      {/* Small screens: bottom sheet with backdrop */}
      <AnimatePresence>
        {(!empty || message) && (
          <>
            {expanded && !empty && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setExpanded(false)}
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
                aria-hidden="true"
              />
            )}

            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="fixed inset-x-0 bottom-0 z-50 border-t border-line-strong bg-surface shadow-sheet lg:hidden pt-2.5"
            >
              <div className="mx-auto max-w-lg px-4" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                {/* Pull handle indicator */}
                <button
                  type="button"
                  className="mx-auto mb-2 block h-1 w-10 cursor-pointer rounded-full border-0 bg-line-strong p-0 transition-colors hover:bg-ink-3"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? 'Collapse seat cart' : 'Expand seat cart'}
                  aria-expanded={expanded}
                />

                {expanded && !empty && (
                  <div className="mb-3 max-h-[45dvh] sm:max-h-56 overflow-y-auto pr-1">
                    <div className="mb-2 flex items-center justify-between border-b border-line pb-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">Your Selection</span>
                      <button
                        type="button"
                        onClick={() => setExpanded(false)}
                        className="text-xs font-medium text-ink-3 hover:text-ink"
                      >
                        Close
                      </button>
                    </div>
                    {seatList}
                  </div>
                )}

                {messageBlock && <div className="mb-2">{messageBlock}</div>}

                {!empty && (
                  <div className="flex items-center gap-2.5 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left"
                      aria-expanded={expanded}
                    >
                      <ChevronUp className={`h-4 w-4 shrink-0 text-ink-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      <span className="min-w-0">
                        <span className="block text-base sm:text-lg font-semibold leading-tight tabular-nums">{formatINR(total)}</span>
                        <span className="block truncate text-xs text-ink-3">
                          {selectedSeats.length} seat{selectedSeats.length === 1 ? '' : 's'}
                          {isHeld && remaining !== null && (
                            <span className={urgent ? 'font-semibold text-danger' : ''}> · {formatClock(remaining)} left</span>
                          )}
                        </span>
                      </span>
                    </button>
                    <div className="w-auto min-w-[120px] sm:min-w-[170px] shrink-0">{primaryAction}</div>
                  </div>
                )}

                {isHeld && !empty && (
                  <button type="button" onClick={handleRelease} disabled={isLoading} className="mt-1 w-full py-1 text-xs text-ink-3 hover:text-ink">
                    Release seats
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
