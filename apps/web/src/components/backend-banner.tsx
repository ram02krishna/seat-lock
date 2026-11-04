'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').trim().replace(/\/+$/, '');

/**
 * The API runs on a free-tier host that sleeps when idle. Rather than showing a permanent
 * notice, stay invisible unless the server hasn't answered after a couple of seconds.
 */
export function BackendBanner() {
  const queryClient = useQueryClient();
  const [slow, setSlow] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let wasSlow = false;
    const startedAt = Date.now();

    let clock: NodeJS.Timeout | null = null;
    const slowTimer = setTimeout(() => {
      if (cancelled) return;
      wasSlow = true;
      setSlow(true);
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      clock = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    }, 2500);

    async function ping() {
      while (!cancelled) {
        const controller = new AbortController();
        const abort = setTimeout(() => controller.abort(), 12000);
        try {
          const res = await fetch(`${API_URL}/health`, { signal: controller.signal, cache: 'no-store' });
          clearTimeout(abort);
          if (res.ok) {
            if (wasSlow) queryClient.invalidateQueries();
            return;
          }
        } catch {
          clearTimeout(abort);
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }

    ping().finally(() => {
      if (cancelled) return;
      clearTimeout(slowTimer);
      if (clock) clearInterval(clock);
      setSlow(false);
    });

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      if (clock) clearInterval(clock);
    };
  }, [queryClient]);

  if (!slow) return null;

  return (
    <div role="status" className="border-b border-line bg-warn-soft text-warn">
      <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-2 text-[13px] sm:px-6">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <p>
          The server is waking up after being idle. This can take up to a minute on the first visit
          <span className="tabular-nums"> ({elapsed}s)</span>.
        </p>
      </div>
    </div>
  );
}
