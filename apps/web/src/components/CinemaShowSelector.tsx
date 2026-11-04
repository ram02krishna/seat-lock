'use client';

import { useMemo, useState, useEffect } from 'react';
import { Calendar, Clock, Film, Sparkles, CheckCircle2 } from 'lucide-react';
import { formatINR } from '@/lib/format';

export interface ShowWithStats {
  id: string;
  startsAt: string;
  totalSeats?: number;
  availableSeats?: number;
  soldSeats?: number;
  soldOut?: boolean;
  pricing?: { VIP?: number; PREMIUM?: number; STANDARD?: number } | null;
  minPrice?: number;
}

interface CinemaShowSelectorProps {
  shows: ShowWithStats[];
  selectedShowId: string | null;
  onSelectShow: (show: ShowWithStats) => void;
}

const weekdayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isToday(d: Date) {
  const today = new Date();
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}

function isTomorrow(d: Date) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return d.getDate() === tomorrow.getDate() && d.getMonth() === tomorrow.getMonth() && d.getFullYear() === tomorrow.getFullYear();
}

export function CinemaShowSelector({
  shows,
  selectedShowId,
  onSelectShow,
}: CinemaShowSelectorProps) {
  // Group shows by date
  const { dateKeys, showsByDate } = useMemo(() => {
    const map = new Map<string, ShowWithStats[]>();
    for (const show of shows) {
      const d = new Date(show.startsAt);
      const key = toDateKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(show);
    }

    // Sort shows within each date chronologically
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }

    const keys = Array.from(map.keys()).sort();
    return { dateKeys: keys, showsByDate: map };
  }, [shows]);

  // Initial selected date
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (selectedShowId) {
      const match = shows.find((s) => s.id === selectedShowId);
      if (match) return toDateKey(new Date(match.startsAt));
    }
    return dateKeys[0] || '';
  });

  // Keep selected date in sync if selectedShowId changes externally
  useEffect(() => {
    if (selectedShowId) {
      const match = shows.find((s) => s.id === selectedShowId);
      if (match) {
        const key = toDateKey(new Date(match.startsAt));
        setSelectedDate(key);
      }
    }
  }, [selectedShowId, shows]);

  // Current shows for the selected date
  const currentShows = showsByDate.get(selectedDate) || [];

  if (shows.length === 0) return null;

  return (
    <div className="card p-4 sm:p-5 space-y-4 border-line-strong bg-surface">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-accent" />
          <h2 className="font-display text-sm sm:text-base font-bold text-ink">
            Select Show Date &amp; Showtime
          </h2>
        </div>
        <span className="text-xs text-ink-3 hidden sm:inline">
          BookMyShow Experience · Instant Seat Lock
        </span>
      </div>

      {/* Step 1: Date Selection Bar */}
      <div className="space-y-1.5">
        <p className="eyebrow text-[10px] text-ink-3">1. Select Date</p>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {dateKeys.map((key) => {
            const [y, m, d] = key.split('-').map(Number);
            const dateObj = new Date(y!, m! - 1, d!);
            const active = selectedDate === key;
            const today = isToday(dateObj);
            const tomorrow = isTomorrow(dateObj);

            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSelectedDate(key);
                  // Auto-select first available show on that date if current is not in that date
                  const showsOnDate = showsByDate.get(key) || [];
                  const firstAvail = showsOnDate.find((s) => !s.soldOut && new Date(s.startsAt).getTime() > Date.now()) || showsOnDate[0];
                  if (firstAvail && firstAvail.id !== selectedShowId) {
                    onSelectShow(firstAvail);
                  }
                }}
                className={`flex shrink-0 flex-col items-center justify-center rounded-xl px-3.5 py-2.5 transition-all text-center min-w-[70px] sm:min-w-[78px] border ${
                  active
                    ? 'border-accent bg-accent text-white shadow-md'
                    : 'border-line bg-sunken/60 text-ink hover:border-line-strong hover:bg-sunken'
                }`}
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-white/90' : 'text-ink-3'}`}>
                  {today ? 'TODAY' : tomorrow ? 'TOM' : weekdayFmt.format(dateObj)}
                </span>
                <span className="text-lg sm:text-xl font-extrabold leading-tight tabular-nums">
                  {dayFmt.format(dateObj)}
                </span>
                <span className={`text-[10px] font-medium uppercase ${active ? 'text-white/80' : 'text-ink-3'}`}>
                  {monthFmt.format(dateObj)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Available Showtimes for Selected Date */}
      <div className="space-y-2 pt-2 border-t border-line/70">
        <div className="flex items-center justify-between">
          <p className="eyebrow text-[10px] text-ink-3">
            2. Available Showtimes ({currentShows.length})
          </p>
          <div className="flex items-center gap-3 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-ok" /> Available
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-warn" /> Selling Fast
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-line-strong" /> Sold Out
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {currentShows.map((show) => {
            const date = new Date(show.startsAt);
            const isSelected = selectedShowId === show.id;
            const isPast = date.getTime() <= Date.now();
            const soldOut = show.soldOut || (show.totalSeats !== undefined && show.availableSeats === 0);
            const disabled = isPast || soldOut;
            const left = show.totalSeats && show.availableSeats !== undefined && show.totalSeats > 0
              ? show.availableSeats / show.totalSeats
              : 1;
            const sellingFast = !disabled && left <= 0.2;

            const minPrice = show.minPrice || show.pricing?.STANDARD || show.pricing?.PREMIUM || 40000;

            return (
              <button
                key={show.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelectShow(show)}
                className={`relative group flex flex-col items-start justify-between rounded-xl p-3 text-left transition-all border ${
                  isSelected
                    ? 'border-accent bg-accent/10 ring-2 ring-accent shadow-sm'
                    : disabled
                      ? 'border-line/40 bg-sunken/40 opacity-55 cursor-not-allowed'
                      : 'border-line bg-surface hover:border-accent/60 hover:bg-sunken/50'
                }`}
              >
                <div className="w-full space-y-1">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-base sm:text-lg font-bold text-ink tracking-tight tabular-nums">
                      {timeFmt.format(date)}
                    </span>
                    {isSelected && (
                      <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-[10px] text-ink-3">
                    <Sparkles className="h-3 w-3 text-accent" />
                    <span>Dolby Atmos 4K</span>
                  </div>
                </div>

                <div className="mt-3 w-full border-t border-line/60 pt-2 flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-ink-2 tabular-nums">
                    {formatINR(minPrice)}
                  </span>

                  {soldOut ? (
                    <span className="text-[10px] font-bold text-ink-3 uppercase">Sold out</span>
                  ) : isPast ? (
                    <span className="text-[10px] text-ink-3 uppercase">Ended</span>
                  ) : sellingFast ? (
                    <span className="text-[10px] font-semibold text-warn">
                      {show.availableSeats} left
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-ok">
                      {show.availableSeats !== undefined ? `${show.availableSeats} open` : 'Available'}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

