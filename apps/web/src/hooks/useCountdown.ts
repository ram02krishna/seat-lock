'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Seconds remaining until `expiresAt`, ticking once a second.
 * `onExpire` fires once when the countdown reaches zero. It is read through a ref,
 * so callers can pass inline callbacks without restarting the interval on every render.
 */
export function useCountdown(expiresAt: string | null | undefined, onExpire?: () => void) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return;
    }

    const target = new Date(expiresAt).getTime();
    let fired = false;
    let id: ReturnType<typeof setInterval>;

    const tick = () => {
      const secs = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setRemaining(secs);
      if (secs === 0) {
        if (!fired) {
          fired = true;
          onExpireRef.current?.();
        }
        clearInterval(id);
      }
    };

    tick();
    id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remaining;
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
