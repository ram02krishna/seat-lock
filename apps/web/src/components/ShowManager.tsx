'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Clock, Edit2, Plus, Trash2, X, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatINR, formatEventDateTime } from '@/lib/format';

export interface ShowTimingItem {
  id: string;
  startsAt: string;
  pricing?: { VIP?: number; PREMIUM?: number; STANDARD?: number } | null;
  totalSeats?: number;
  soldSeats?: number;
  heldSeats?: number;
  availableSeats?: number;
  soldOut?: boolean;
  occupancyRate?: number;
  revenueCents?: number;
}

export interface ShowManagerProps {
  eventId: string;
  eventTitle: string;
  shows: ShowTimingItem[];
  defaultPrices?: { VIP?: number; PREMIUM?: number; STANDARD?: number };
  onUpdated?: () => void;
  title?: string;
  optionalBadge?: boolean;
  subtitle?: string;
  buttonLabel?: string;
  compactContainer?: boolean;
}

export function ShowManager({
  eventId,
  eventTitle,
  shows,
  defaultPrices,
  onUpdated,
  title,
  optionalBadge,
  subtitle,
  buttonLabel,
  compactContainer = false,
}: ShowManagerProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingShow, setEditingShow] = useState<ShowTimingItem | null>(null);
  const [deletingShow, setDeletingShow] = useState<ShowTimingItem | null>(null);

  // Form state
  const [startsAt, setStartsAt] = useState('');
  const [vipPrice, setVipPrice] = useState(defaultPrices?.VIP ? String(defaultPrices.VIP / 100) : '1200');
  const [premiumPrice, setPremiumPrice] = useState(defaultPrices?.PREMIUM ? String(defaultPrices.PREMIUM / 100) : '700');
  const [standardPrice, setStandardPrice] = useState(defaultPrices?.STANDARD ? String(defaultPrices.STANDARD / 100) : '400');
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm() {
    setStartsAt('');
    setVipPrice(defaultPrices?.VIP ? String(defaultPrices.VIP / 100) : '1200');
    setPremiumPrice(defaultPrices?.PREMIUM ? String(defaultPrices.PREMIUM / 100) : '700');
    setStandardPrice(defaultPrices?.STANDARD ? String(defaultPrices.STANDARD / 100) : '400');
    setFormError(null);
    setIsAdding(false);
    setEditingShow(null);
  }

  function openEdit(show: ShowTimingItem) {
    const d = new Date(show.startsAt);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setStartsAt(d.toISOString().slice(0, 16));
    const pr = show.pricing || defaultPrices;
    setVipPrice(pr?.VIP ? String(pr.VIP / 100) : '1200');
    setPremiumPrice(pr?.PREMIUM ? String(pr.PREMIUM / 100) : '700');
    setStandardPrice(pr?.STANDARD ? String(pr.STANDARD / 100) : '400');
    setEditingShow(show);
    setIsAdding(false);
    setFormError(null);
  }

  const addShowMutation = useMutation({
    mutationFn: async () => {
      if (!startsAt) throw new Error('Please select a date and showtime');
      const time = new Date(startsAt);
      if (time.getTime() <= Date.now()) throw new Error('Showtime must be in the future');

      const pricing = {
        VIP: Math.round(Number(vipPrice) * 100) || 120000,
        PREMIUM: Math.round(Number(premiumPrice) * 100) || 70000,
        STANDARD: Math.round(Number(standardPrice) * 100) || 40000,
      };

      return apiFetch(`/api/organizer/events/${eventId}/shows`, {
        method: 'POST',
        body: JSON.stringify({
          startsAt: time.toISOString(),
          pricing,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      resetForm();
      onUpdated?.();
    },
    onError: (err: any) => {
      setFormError(err.message || 'Could not add showtiming');
    },
  });

  const editShowMutation = useMutation({
    mutationFn: async () => {
      if (!editingShow) return;
      if (!startsAt) throw new Error('Please select a date and showtime');
      const time = new Date(startsAt);
      if (time.getTime() <= Date.now()) throw new Error('Showtime must be in the future');

      const pricing = {
        VIP: Math.round(Number(vipPrice) * 100) || 120000,
        PREMIUM: Math.round(Number(premiumPrice) * 100) || 70000,
        STANDARD: Math.round(Number(standardPrice) * 100) || 40000,
      };

      return apiFetch(`/api/organizer/events/${eventId}/shows/${editingShow.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          startsAt: time.toISOString(),
          pricing,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      resetForm();
      onUpdated?.();
    },
    onError: (err: any) => {
      setFormError(err.message || 'Could not update showtiming');
    },
  });

  const deleteShowMutation = useMutation({
    mutationFn: async (showId: string) => {
      return apiFetch(`/api/organizer/events/${eventId}/shows/${showId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setDeletingShow(null);
      onUpdated?.();
    },
    onError: (err: any) => {
      alert(err.message || 'Could not remove showtiming');
    },
  });

  return (
    <section
      className={
        compactContainer
          ? 'space-y-4 rounded-lg border border-line bg-sunken/40 p-4'
          : 'space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6'
      }
      aria-labelledby="shows-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2
            id="shows-heading"
            className={
              compactContainer
                ? 'text-sm font-semibold text-ink flex items-center gap-1.5'
                : 'text-base sm:text-lg font-bold font-display text-ink flex items-center gap-2'
            }
          >
            <Clock className={compactContainer ? 'h-4 w-4 text-accent' : 'h-5 w-5 text-accent'} />
            <span>{title || `Show Timings (${shows.length})`}</span>
            {optionalBadge && <span className="font-normal text-ink-3 text-xs sm:text-sm">(optional)</span>}
          </h2>
          <p className="text-xs sm:text-[13px] text-ink-3">
            {subtitle || 'Manage multiple showtimes for this cinema event. Each show maintains separate seat bookings.'}
          </p>
        </div>
        {!isAdding && !editingShow && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setIsAdding(true);
            }}
            className="btn btn-secondary btn-xs inline-flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            {buttonLabel || 'Add Showtime'}
          </button>
        )}
      </div>

      {/* Inline Form for Adding or Editing Show */}
      {(isAdding || editingShow) && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">
              {editingShow ? 'Edit Show Timing' : 'Add New Show Timing'}
            </h3>
            <button
              type="button"
              onClick={resetForm}
              className="text-ink-3 hover:text-ink p-1 rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">
                Show Date &amp; Time *
              </label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="field !py-1.5 text-sm w-full"
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">VIP (₹)</label>
                <input
                  type="number"
                  value={vipPrice}
                  onChange={(e) => setVipPrice(e.target.value)}
                  className="field !py-1.5 text-sm w-full"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Premium (₹)</label>
                <input
                  type="number"
                  value={premiumPrice}
                  onChange={(e) => setPremiumPrice(e.target.value)}
                  className="field !py-1.5 text-sm w-full"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Standard (₹)</label>
                <input
                  type="number"
                  value={standardPrice}
                  onChange={(e) => setStandardPrice(e.target.value)}
                  className="field !py-1.5 text-sm w-full"
                  min="1"
                />
              </div>
            </div>
          </div>

          {formError && (
            <div className="text-xs text-bad bg-bad/10 border border-bad/30 rounded p-2 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="btn btn-secondary btn-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (editingShow) editShowMutation.mutate();
                else addShowMutation.mutate();
              }}
              disabled={addShowMutation.isPending || editShowMutation.isPending}
              className="btn btn-primary btn-xs"
            >
              {addShowMutation.isPending || editShowMutation.isPending
                ? 'Saving...'
                : editingShow
                  ? 'Update Show'
                  : 'Save Show'}
            </button>
          </div>
        </div>
      )}

      {/* Shows List */}
      {shows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-ink-3">
          No show timings configured yet. Click “Add Show Timing” to add your first movie showtime.
        </div>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line bg-surface overflow-hidden">
          {shows.map((show) => {
            const date = new Date(show.startsAt);
            const isPast = date.getTime() <= Date.now();
            return (
              <div
                key={show.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-sunken/40 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-ink">
                      {formatEventDateTime(show.startsAt)}
                    </span>
                    {isPast ? (
                      <span className="tag text-[10px] bg-sunken text-ink-3">Ended</span>
                    ) : show.soldOut ? (
                      <span className="tag text-[10px] bg-bad/15 text-bad">Sold Out</span>
                    ) : (
                      <span className="tag text-[10px] bg-ok/15 text-ok">Active</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ink-3 flex-wrap">
                    {show.totalSeats !== undefined && (
                      <span>
                        Seats: <strong className="text-ink">{show.availableSeats ?? show.totalSeats} open</strong> / {show.totalSeats} total
                      </span>
                    )}
                    {show.soldSeats !== undefined && show.soldSeats > 0 && (
                      <span>
                        Sold: <strong className="text-ink">{show.soldSeats}</strong>
                      </span>
                    )}
                    {show.revenueCents !== undefined && show.revenueCents > 0 && (
                      <span>
                        Revenue: <strong className="text-ok font-medium">{formatINR(show.revenueCents)}</strong>
                      </span>
                    )}
                    {show.pricing && (
                      <span className="tabular-nums">
                        Standard: {formatINR(show.pricing.STANDARD || 40000)} · Premium: {formatINR(show.pricing.PREMIUM || 70000)} · VIP: {formatINR(show.pricing.VIP || 120000)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(show)}
                    className="btn btn-secondary btn-xs inline-flex items-center gap-1"
                    title="Edit show timing"
                  >
                    <Edit2 className="h-3 w-3" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingShow(show)}
                    className="btn btn-secondary text-bad hover:bg-bad/10 hover:border-bad/40 btn-xs inline-flex items-center gap-1"
                    title="Delete show timing"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Show Confirmation Modal */}
      {deletingShow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm animate-fade-in">
          <div className="card max-w-sm w-full p-5 shadow-xl space-y-4 border-line-strong bg-surface">
            <div className="flex items-start justify-between">
              <h3 className="font-bold text-base text-ink">Delete Show Timing?</h3>
              <button
                type="button"
                onClick={() => setDeletingShow(null)}
                className="text-ink-3 hover:text-ink p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">
              Are you sure you want to delete the show scheduled for{' '}
              <strong className="text-ink font-semibold">{formatEventDateTime(deletingShow.startsAt)}</strong>? This will remove its seats and availability.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setDeletingShow(null)}
                className="btn btn-secondary btn-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteShowMutation.mutate(deletingShow.id)}
                disabled={deleteShowMutation.isPending}
                className="btn bg-bad hover:bg-bad/90 text-white font-semibold btn-xs inline-flex items-center gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleteShowMutation.isPending ? 'Deleting...' : 'Delete Show'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
