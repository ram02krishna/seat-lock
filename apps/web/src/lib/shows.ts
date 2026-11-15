/**
 * Show-timing helpers shared by the "New event" form and the "Edit event" page, so a cinema's
 * showtimes are validated and converted exactly the same way in both places.
 */

export type TierKey = 'VIP' | 'PREMIUM' | 'STANDARD';
export type TierPricing = Partial<Record<TierKey, number>>;

/** A show as the UI handles it. `pricing` is in paise, like the API. */
export interface ShowTimingItem {
  id: string;
  startsAt: string;
  pricing?: TierPricing | null;
  totalSeats?: number;
  soldSeats?: number;
  heldSeats?: number;
  availableSeats?: number;
  soldOut?: boolean;
  occupancyRate?: number;
  revenueCents?: number;
}

/** Text-input state of the add / edit show form (rupees, local date-time). */
export interface ShowFormValues {
  startsAt: string;
  vip: string;
  premium: string;
  standard: string;
}

/** Used only when the organizer has not picked a price yet (matches the cinema template). */
export const CINEMA_DEFAULT_RUPEES = { vip: '1200', premium: '700', standard: '400' };

/** `<input type="datetime-local">` wants local time, not UTC. */
export function toLocalInput(iso: string | Date): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function localNowForInput(): string {
  return toLocalInput(new Date());
}

export function paiseToRupeeString(paise: number | null | undefined, fallback: string): string {
  return paise == null || !Number.isFinite(paise) || paise <= 0 ? fallback : String(paise / 100);
}

export function rupeesToPaise(value: string, label: string): number {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n <= 0) throw new Error(`Enter a price above zero for ${label}.`);
  return Math.round(n * 100);
}

export function showFormFromPricing(startsAt: string, pricing?: TierPricing | null, fallback?: TierPricing | null): ShowFormValues {
  const p = pricing ?? fallback ?? undefined;
  return {
    startsAt,
    vip: paiseToRupeeString(p?.VIP ?? fallback?.VIP, CINEMA_DEFAULT_RUPEES.vip),
    premium: paiseToRupeeString(p?.PREMIUM ?? fallback?.PREMIUM, CINEMA_DEFAULT_RUPEES.premium),
    standard: paiseToRupeeString(p?.STANDARD ?? fallback?.STANDARD, CINEMA_DEFAULT_RUPEES.standard),
  };
}

export interface ValidatedShow {
  startsAt: string; // ISO
  pricing: Required<TierPricing>; // paise
}

/**
 * Validates one show form. `otherShows` are the other showtimes of the same event (the show being
 * edited must not be in the list), used to reject two shows at the same minute.
 * Throws an Error with a message that is safe to show to the organizer.
 */
export function validateShowForm(values: ShowFormValues, otherShows: Array<{ startsAt: string }>, now = Date.now()): ValidatedShow {
  if (!values.startsAt) throw new Error('Pick a date and time for the show.');
  const when = new Date(values.startsAt);
  if (Number.isNaN(when.getTime())) throw new Error('That show date and time is not valid.');
  if (when.getTime() <= now) throw new Error('The show needs to be in the future.');
  if (otherShows.some((s) => new Date(s.startsAt).getTime() === when.getTime())) {
    throw new Error('Another show is already scheduled at that date and time.');
  }
  return {
    startsAt: when.toISOString(),
    pricing: {
      VIP: rupeesToPaise(values.vip, 'VIP'),
      PREMIUM: rupeesToPaise(values.premium, 'Premium'),
      STANDARD: rupeesToPaise(values.standard, 'Standard'),
    },
  };
}

/** Earliest show first. */
export function sortShows<T extends { startsAt: string }>(shows: T[]): T[] {
  return [...shows].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

/** The prices a new show should start from: the most recently added one, else the cinema defaults. */
export function latestShowPricing(shows: ShowTimingItem[]): TierPricing | undefined {
  for (let i = shows.length - 1; i >= 0; i--) {
    if (shows[i]?.pricing) return shows[i]!.pricing!;
  }
  return undefined;
}
