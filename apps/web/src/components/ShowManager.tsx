'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Clock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatINR, formatEventDateTime } from '@/lib/format';
import {
  localNowForInput,
  latestShowPricing,
  showFormFromPricing,
  sortShows,
  toLocalInput,
  validateShowForm,
  type ShowFormValues,
  type ShowTimingItem,
  type TierPricing,
  type ValidatedShow,
} from '@/lib/shows';

export type { ShowTimingItem } from '@/lib/shows';

export interface ShowManagerProps {
  /**
   * `live`  – the event exists: every add / edit / delete is saved to the API straight away.
   * `draft` – the event is being created: shows live in the parent's state until it is published.
   * Both modes render the same list, the same form and run the same validation.
   */
  mode?: 'live' | 'draft';
  /** Required in live mode. */
  eventId?: string;
  shows: ShowTimingItem[];
  /** Draft mode: receives the new list after every add / edit / remove. */
  onChange?: (shows: ShowTimingItem[]) => void;
  /** Live mode: called after the server accepted a change (refetch the event). */
  onUpdated?: () => void;
  /** Prices (paise) a new show starts from. Defaults to the most recently added show. */
  defaultPrices?: TierPricing;
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  /** `section` is a standalone card; `inline` sits inside another form card. */
  variant?: 'section' | 'inline';
  disabled?: boolean;
}

export function ShowManager({
  mode = 'live',
  eventId,
  shows,
  onChange,
  onUpdated,
  defaultPrices,
  title,
  subtitle,
  buttonLabel = 'Add showtime',
  variant = 'section',
  disabled = false,
}: ShowManagerProps) {
  const queryClient = useQueryClient();
  const isLive = mode === 'live';
  const draftCounter = useRef(0);

  const [isAdding, setIsAdding] = useState(false);
  const [editingShow, setEditingShow] = useState<ShowTimingItem | null>(null);
  const [deletingShow, setDeletingShow] = useState<ShowTimingItem | null>(null);
  const [values, setValues] = useState<ShowFormValues>(() => showFormFromPricing('', defaultPrices));
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmMove, setConfirmMove] = useState(false);

  const sorted = sortShows(shows);
  const isFormOpen = isAdding || !!editingShow;

  function priceBase(): TierPricing | undefined {
    return defaultPrices ?? latestShowPricing(sorted);
  }

  function closeForm() {
    setIsAdding(false);
    setEditingShow(null);
    setFormError(null);
    setConfirmMove(false);
  }

  function openAdd() {
    setValues(showFormFromPricing('', priceBase()));
    setEditingShow(null);
    setIsAdding(true);
    setFormError(null);
    setInfo(null);
    setConfirmMove(false);
  }

  function openEdit(show: ShowTimingItem) {
    setValues(showFormFromPricing(toLocalInput(show.startsAt), show.pricing, priceBase()));
    setIsAdding(false);
    setEditingShow(show);
    setFormError(null);
    setInfo(null);
    setConfirmMove(false);
  }

  function refreshAfterLiveChange() {
    queryClient.invalidateQueries({ queryKey: ['organizer'] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
    onUpdated?.();
  }

  const saveShow = useMutation({
    mutationFn: async (validated: ValidatedShow) => {
      if (!isLive) {
        const next: ShowTimingItem = {
          id: editingShow?.id ?? `draft-${++draftCounter.current}`,
          startsAt: validated.startsAt,
          pricing: validated.pricing,
        };
        onChange?.(editingShow ? shows.map((s) => (s.id === editingShow.id ? next : s)) : [...shows, next]);
        return { notifiedCustomers: 0 };
      }
      if (!eventId) throw new Error('Missing event.');
      const moved = !!editingShow && new Date(editingShow.startsAt).getTime() !== new Date(validated.startsAt).getTime();
      return apiFetch<{ notifiedCustomers?: number }>(
        editingShow ? `/api/organizer/events/${eventId}/shows/${editingShow.id}` : `/api/organizer/events/${eventId}/shows`,
        {
          method: editingShow ? 'PUT' : 'POST',
          body: JSON.stringify({
            startsAt: validated.startsAt,
            pricing: validated.pricing,
            ...(moved && confirmMove ? { confirm: true } : {}),
          }),
        },
      );
    },
    onSuccess: (res) => {
      const wasEditing = !!editingShow;
      closeForm();
      if (isLive) {
        setInfo(
          res.notifiedCustomers
            ? `Showtime updated. ${res.notifiedCustomers} ticket holder(s) were emailed about the change.`
            : wasEditing
              ? 'Showtime updated.'
              : 'Showtime added.',
        );
        refreshAfterLiveChange();
      }
    },
    onError: (err: unknown) => {
      const e = err as ApiError;
      if (e?.data?.code === 'CONFIRMATION_REQUIRED') setConfirmMove(false);
      setFormError(e?.message || 'Could not save the showtime.');
    },
  });

  const deleteShow = useMutation({
    mutationFn: async (show: ShowTimingItem) => {
      if (!isLive) {
        onChange?.(shows.filter((s) => s.id !== show.id));
        return;
      }
      await apiFetch(`/api/organizer/events/${eventId}/shows/${show.id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      setDeletingShow(null);
      if (isLive) {
        setInfo('Showtime deleted.');
        refreshAfterLiveChange();
      }
    },
    onError: (err: unknown) => {
      setDeletingShow(null);
      setFormError((err as ApiError)?.message || 'Could not delete the showtime.');
    },
  });

  function submitForm() {
    setFormError(null);
    try {
      const others = sorted.filter((s) => s.id !== editingShow?.id);
      saveShow.mutate(validateShowForm(values, others));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Check the showtime and try again.');
    }
  }

  const set = (key: keyof ShowFormValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const priceField = (key: 'vip' | 'premium' | 'standard', label: string) => (
    <div>
      <label className="field-label" htmlFor={`show-${key}`}>
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">₹</span>
        <input
          id={`show-${key}`}
          type="number"
          min={1}
          step="any"
          inputMode="decimal"
          value={values[key]}
          onChange={set(key)}
          className="field pl-7 tabular-nums"
        />
      </div>
    </div>
  );

  const movingSoldShow =
    isLive &&
    !!editingShow &&
    (editingShow.soldSeats ?? 0) > 0 &&
    !!values.startsAt &&
    new Date(values.startsAt).getTime() !== new Date(editingShow.startsAt).getTime();

  const saving = saveShow.isPending;

  return (
    <section
      className={variant === 'inline' ? 'space-y-4 rounded-lg border border-line bg-sunken/40 p-4' : 'card space-y-4 p-5 sm:p-6'}
      aria-labelledby={`shows-heading-${mode}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <h2
            id={`shows-heading-${mode}`}
            className={
              variant === 'inline'
                ? 'flex items-center gap-2 text-sm font-semibold text-ink'
                : 'flex items-center gap-2 font-display text-xl font-semibold text-ink'
            }
          >
            <Clock className={variant === 'inline' ? 'h-4 w-4 text-accent' : 'h-5 w-5 text-accent'} />
            <span>{title ?? `Show timings (${shows.length})`}</span>
          </h2>
          <p className="text-xs text-ink-3 sm:text-[13px]">
            {subtitle ?? 'Each showtime has its own seat bookings and ticket prices.'}
          </p>
        </div>
        {!isFormOpen && (
          <button
            type="button"
            onClick={openAdd}
            disabled={disabled}
            className="btn btn-secondary btn-xs self-start sm:self-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            {buttonLabel}
          </button>
        )}
      </div>

      {info && !isFormOpen && (
        <p role="status" className="notice notice-ok">
          {info}
        </p>
      )}

      {isFormOpen && (
        <div
          className="space-y-4 rounded-lg border border-accent/30 bg-accent-soft/40 p-4"
          // Enter saves the showtime instead of submitting the page form this component may sit in
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
              e.preventDefault();
              if (!saving) submitForm();
            }
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{editingShow ? 'Edit showtime' : 'New showtime'}</h3>
            <button type="button" onClick={closeForm} className="btn btn-ghost !p-1.5" aria-label="Close showtime form">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div>
              <label className="field-label" htmlFor="show-startsAt">
                Date &amp; time
              </label>
              <input
                id="show-startsAt"
                type="datetime-local"
                min={localNowForInput()}
                value={values.startsAt}
                onChange={set('startsAt')}
                className="field"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {priceField('vip', 'VIP')}
              {priceField('premium', 'Premium')}
              {priceField('standard', 'Standard')}
            </div>
          </div>

          {movingSoldShow && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmMove}
                onChange={(e) => setConfirmMove(e.target.checked)}
              />
              <span>
                {editingShow!.soldSeats} ticket{editingShow!.soldSeats === 1 ? ' has' : 's have'} already been sold for this
                show. They stay valid, and ticket holders will be emailed about the new time.
              </span>
            </label>
          )}

          {formError && (
            <p role="alert" className="notice notice-error">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeForm} disabled={saving} className="btn btn-secondary btn-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitForm}
              disabled={saving || (movingSoldShow && !confirmMove)}
              className="btn btn-primary btn-sm"
            >
              {saving ? 'Saving…' : editingShow ? 'Update showtime' : 'Add showtime'}
            </button>
          </div>
        </div>
      )}

      {!isFormOpen && formError && (
        <p role="alert" className="notice notice-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-3">
          No showtimes yet. Use “{buttonLabel}” to add the first one.
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {sorted.map((show) => {
            const isPast = new Date(show.startsAt).getTime() <= Date.now();
            const hasSales = (show.soldSeats ?? 0) > 0;
            const isLastLive = isLive && sorted.length <= 1;
            const deleteBlockedReason = hasSales
              ? 'Tickets have been sold for this show'
              : isLastLive
                ? 'An event needs at least one showtime'
                : undefined;
            return (
              <div
                key={show.id}
                className="flex flex-col gap-3 p-3.5 transition-colors hover:bg-sunken/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{formatEventDateTime(show.startsAt)}</span>
                    {isLive &&
                      (isPast ? (
                        <span className="tag">Ended</span>
                      ) : show.soldOut ? (
                        <span className="tag bg-danger-soft text-danger">Sold out</span>
                      ) : (
                        <span className="tag bg-ok-soft text-ok">On sale</span>
                      ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-3">
                    {show.totalSeats !== undefined && (
                      <span className="tabular-nums">
                        <strong className="font-semibold text-ink">{show.availableSeats ?? show.totalSeats}</strong> open of{' '}
                        {show.totalSeats}
                      </span>
                    )}
                    {hasSales && (
                      <span className="tabular-nums">
                        Sold <strong className="font-semibold text-ink">{show.soldSeats}</strong>
                      </span>
                    )}
                    {!!show.revenueCents && show.revenueCents > 0 && (
                      <span className="tabular-nums">
                        Revenue <strong className="font-semibold text-ink">{formatINR(show.revenueCents)}</strong>
                      </span>
                    )}
                    {show.pricing && (
                      <span className="tabular-nums">
                        Standard {show.pricing.STANDARD != null ? formatINR(show.pricing.STANDARD) : '–'} · Premium{' '}
                        {show.pricing.PREMIUM != null ? formatINR(show.pricing.PREMIUM) : '–'} · VIP{' '}
                        {show.pricing.VIP != null ? formatINR(show.pricing.VIP) : '–'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => openEdit(show)}
                    disabled={disabled || (isLive && isPast)}
                    className="btn btn-edit btn-xs"
                    title={isLive && isPast ? 'This show has already started' : 'Edit showtime'}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => (isLive ? setDeletingShow(show) : deleteShow.mutate(show))}
                    disabled={disabled || !!deleteBlockedReason}
                    className="btn btn-delete btn-xs"
                    title={deleteBlockedReason ?? 'Delete showtime'}
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

      {deletingShow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-show-title"
          className="fixed inset-0 z-50 flex animate-rise items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
        >
          <div className="card w-full max-w-sm space-y-4 border-line p-5 shadow-lift">
            <div className="flex items-start justify-between">
              <h3 id="delete-show-title" className="font-display text-base font-semibold text-ink">
                Delete this showtime?
              </h3>
              <button
                type="button"
                onClick={() => setDeletingShow(null)}
                disabled={deleteShow.isPending}
                className="btn btn-ghost !p-1.5"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm leading-relaxed text-ink-2">
              The show on <strong className="font-semibold text-ink">{formatEventDateTime(deletingShow.startsAt)}</strong> and its
              seat map will be deleted. This can’t be undone.
            </p>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button type="button" onClick={() => setDeletingShow(null)} disabled={deleteShow.isPending} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteShow.mutate(deletingShow)}
                disabled={deleteShow.isPending}
                className="btn btn-danger btn-sm"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleteShow.isPending ? 'Deleting…' : 'Delete showtime'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
