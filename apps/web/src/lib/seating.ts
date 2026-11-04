/** Mirrors the server's seat-layout defaults so the forms can preview what will be generated. */
export const MAX_SEATS_PER_EVENT = 2000;
export const MAX_SEATS_PER_ROW = 50;

export function autoSeatsPerRow(total: number): number {
  const guess = Math.round(Math.sqrt(total * 2));
  return Math.max(1, Math.min(total, Math.max(4, Math.min(30, guess))));
}

export function parseCount(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export interface SeatingPreview {
  vip: number;
  premium: number;
  standard: number;
  seatsPerRow: number;
  rows: number;
}

/** Returns the preview, or an error message when the numbers don't add up. */
export function previewSeating(
  totalValue: string,
  perRowValue: string,
  vipValue: string,
  premiumValue: string,
): { preview?: SeatingPreview; error?: string } {
  const total = parseCount(totalValue);
  if (total === undefined || Number.isNaN(total) || !Number.isInteger(total) || total < 1) {
    return { error: 'Enter the total number of seats (a whole number, at least 1).' };
  }
  if (total > MAX_SEATS_PER_EVENT) return { error: `An event can have at most ${MAX_SEATS_PER_EVENT} seats.` };

  const perRowRaw = parseCount(perRowValue);
  if (perRowRaw !== undefined && (Number.isNaN(perRowRaw) || !Number.isInteger(perRowRaw) || perRowRaw < 1 || perRowRaw > MAX_SEATS_PER_ROW)) {
    return { error: `Seats per row must be a whole number from 1 to ${MAX_SEATS_PER_ROW}.` };
  }
  const vipRaw = parseCount(vipValue);
  const premiumRaw = parseCount(premiumValue);
  for (const [label, v] of [['VIP', vipRaw], ['Premium', premiumRaw]] as const) {
    if (v !== undefined && (Number.isNaN(v) || !Number.isInteger(v) || v < 0)) {
      return { error: `${label} seats must be a whole number, 0 or more.` };
    }
  }
  if ((vipRaw ?? 0) + (premiumRaw ?? 0) > total) {
    return { error: 'VIP + Premium seats cannot exceed the total number of seats.' };
  }

  const vip = vipRaw ?? Math.round(total * 0.15);
  const premium = Math.min(premiumRaw ?? Math.round(total * 0.3), total - vip);
  const standard = total - vip - premium;
  const seatsPerRow = Math.min(perRowRaw ?? autoSeatsPerRow(total), total);
  const rows = [vip, premium, standard].reduce((sum, n) => sum + (n > 0 ? Math.ceil(n / seatsPerRow) : 0), 0);
  return { preview: { vip, premium, standard, seatsPerRow, rows } };
}

/** Empty string -> undefined, for optional text inputs. */
export function optionalText(value: string): string | undefined {
  const v = value.trim();
  return v ? v : undefined;
}
