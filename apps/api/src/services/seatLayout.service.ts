import { MAX_SEATS_PER_EVENT, MAX_SEATS_PER_ROW } from '@repo/shared';
import type { VenueType } from '@repo/shared';
import { AppError } from '../errors';
import { getVenueTemplate } from './venueTemplates.service';

/**
 * Capacity-driven seat layout.
 *
 * Instead of a fixed template with a hardcoded number of seats, the organizer gives a total
 * capacity (and optionally seats-per-row and the VIP / Premium split). The functions here turn
 * that into concrete seats with unique (section, row, number) identifiers and x/y coordinates
 * that the existing SeatMap component already knows how to draw.
 *
 * Everything in this file is pure (no database access) so it is easy to test.
 */

export const TIER_ORDER = ['VIP', 'PREMIUM', 'STANDARD'] as const;

const SEAT_SPACING = 48;
const ROW_SPACING = 48;
const TIER_GAP = 40; // extra vertical room between tier blocks (for the section caption)
const MARGIN_X = 90;
const STAGE_Y = 22;
const STAGE_HEIGHT = 48;
const FIRST_ROW_OFFSET = 80; // distance from the bottom of the stage to the first row
const CURVE_SAG = 16;

export interface PlannedSeat {
  section: string;
  row: string;
  number: number;
  x: number;
  y: number;
  tier: string;
}

export interface SeatGridConfig {
  seatsPerRow: number;
  seatSpacing: number;
  rowSpacing: number;
  /** Extra horizontal gap in the middle of every row (centre aisle / runway). 0 = none. */
  aisleGap: number;
  cx: number;
  firstRowY: number;
  curve: boolean;
}

export interface ExistingSeat {
  id: string;
  section: string;
  row: string;
  number: number;
  x: number;
  y: number;
  tier: string;
}

// ---- row labels -------------------------------------------------------------------------------

/** 0 -> A, 25 -> Z, 26 -> AA ... */
export function rowLabel(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Inverse of rowLabel. Returns -1 for labels that are not A-Z sequences. */
export function rowIndexOf(label: string): number {
  if (!/^[A-Z]+$/.test(label)) return -1;
  let n = 0;
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---- geometry ---------------------------------------------------------------------------------

function rowWidth(cfg: SeatGridConfig): number {
  return (cfg.seatsPerRow - 1) * cfg.seatSpacing + cfg.aisleGap;
}

export function seatX(cfg: SeatGridConfig, number: number): number {
  const leftCount = Math.floor(cfg.seatsPerRow / 2);
  const x0 = cfg.cx - rowWidth(cfg) / 2;
  const gap = cfg.aisleGap > 0 && number > leftCount ? cfg.aisleGap : 0;
  return Math.round(x0 + (number - 1) * cfg.seatSpacing + gap);
}

export function seatY(cfg: SeatGridConfig, baseY: number, x: number): number {
  if (!cfg.curve) return Math.round(baseY);
  const half = Math.max(1, rowWidth(cfg) / 2);
  const ratio = Math.min(1, Math.abs(x - cfg.cx) / half);
  return Math.round(baseY + Math.pow(ratio, 1.8) * CURVE_SAG);
}

// ---- sizing helpers ---------------------------------------------------------------------------

export function autoSeatsPerRow(total: number): number {
  const guess = Math.round(Math.sqrt(total * 2));
  return Math.max(1, Math.min(total, Math.max(4, Math.min(30, guess))));
}

export function resolveTierCounts(total: number, vip?: number, premium?: number) {
  if (vip !== undefined && premium !== undefined && vip + premium > total) {
    throw new AppError(400, 'VIP + Premium seats cannot exceed the total number of seats');
  }
  if ((vip ?? 0) > total) throw new AppError(400, 'VIP seats cannot exceed the total number of seats');
  const v = vip ?? Math.round(total * 0.15);
  const p = Math.min(premium ?? Math.round(total * 0.3), total - v);
  const s = total - v - p;
  return { VIP: v, PREMIUM: p, STANDARD: s };
}

function aisleFor(type: VenueType, seatsPerRow: number): number {
  if (seatsPerRow < 4) return 0;
  switch (type) {
    case 'ARENA':
      return 72; // leaves room for the runway drawn down the middle
    case 'THEATER_DOLBY':
    case 'CONFERENCE_HALL':
      return 48;
    case 'AUDITORIUM':
      return 40;
    default:
      return 0;
  }
}

// ---- initial generation -----------------------------------------------------------------------

export interface SeatPlanInput {
  venueType: VenueType;
  totalSeats: number;
  seatsPerRow?: number;
  vipSeats?: number;
  premiumSeats?: number;
}

export interface SeatPlan {
  seats: PlannedSeat[];
  layout: Record<string, any>;
  tierCounts: Record<string, number>;
  seatsPerRow: number;
}

export function buildSeatPlan(input: SeatPlanInput): SeatPlan {
  const { venueType, totalSeats } = input;
  if (!Number.isInteger(totalSeats) || totalSeats < 1 || totalSeats > MAX_SEATS_PER_EVENT) {
    throw new AppError(400, `Total seats must be between 1 and ${MAX_SEATS_PER_EVENT}`);
  }
  const seatsPerRow = Math.min(input.seatsPerRow ?? autoSeatsPerRow(totalSeats), MAX_SEATS_PER_ROW, totalSeats);
  if (seatsPerRow < 1) throw new AppError(400, 'Seats per row must be at least 1');

  const tierCounts = resolveTierCounts(totalSeats, input.vipSeats, input.premiumSeats);
  const template = getVenueTemplate(venueType);

  const aisleGap = aisleFor(venueType, seatsPerRow);
  const width = (seatsPerRow - 1) * SEAT_SPACING + aisleGap;
  const cx = Math.max(500, Math.round(width / 2 + MARGIN_X));
  const cfg: SeatGridConfig = {
    seatsPerRow,
    seatSpacing: SEAT_SPACING,
    rowSpacing: ROW_SPACING,
    aisleGap,
    cx,
    firstRowY: STAGE_Y + STAGE_HEIGHT + FIRST_ROW_OFFSET,
    curve: venueType === 'AUDITORIUM',
  };

  const seats: PlannedSeat[] = [];
  let rowIdx = 0;
  let baseY = cfg.firstRowY;
  let tiersUsed = 0;
  for (const tier of TIER_ORDER) {
    const count = tierCounts[tier] ?? 0;
    if (count <= 0) continue;
    if (tiersUsed > 0) baseY += TIER_GAP;
    tiersUsed += 1;
    let remaining = count;
    while (remaining > 0) {
      const inRow = Math.min(seatsPerRow, remaining);
      const label = rowLabel(rowIdx++);
      for (let num = 1; num <= inRow; num++) {
        const x = seatX(cfg, num);
        seats.push({ section: tier, row: label, number: num, x, y: seatY(cfg, baseY, x), tier });
      }
      baseY += cfg.rowSpacing;
      remaining -= inRow;
    }
  }

  const stageWidth = Math.max(320, Math.min(760, Math.round(width * 0.7)));
  const tplLayout = template.layout;
  const layout: Record<string, any> = {
    width: cx * 2,
    height: Math.round(baseY + 60),
    type: venueType,
    stage: { ...tplLayout.stage, x: Math.round(cx - stageWidth / 2), y: STAGE_Y, width: stageWidth, height: STAGE_HEIGHT },
    features: tplLayout.features,
    sections: tplLayout.sections.filter((s) => (tierCounts[s.tier as keyof typeof tierCounts] ?? 0) > 0),
    generated: true,
    capacity: totalSeats,
    config: cfg,
    tierCounts,
  };

  return { seats, layout, tierCounts, seatsPerRow };
}

// ---- growing an existing layout ---------------------------------------------------------------

function groupByRow<T extends { row: string }>(seats: T[]): Map<string, T[]> {
  const rows = new Map<string, T[]>();
  for (const s of seats) {
    const list = rows.get(s.row);
    if (list) list.push(s);
    else rows.set(s.row, [s]);
  }
  return rows;
}

/** Grid settings for an existing venue: the stored config for generated layouts, a best guess for legacy ones. */
export function gridConfigFor(layout: any, existing: ExistingSeat[]): SeatGridConfig {
  const stored = layout?.config as Partial<SeatGridConfig> | undefined;
  if (stored && Number.isFinite(stored.seatsPerRow) && Number.isFinite(stored.cx) && Number.isFinite(stored.seatSpacing)) {
    return {
      seatsPerRow: stored.seatsPerRow!,
      seatSpacing: stored.seatSpacing!,
      rowSpacing: stored.rowSpacing ?? ROW_SPACING,
      aisleGap: stored.aisleGap ?? 0,
      cx: stored.cx!,
      firstRowY: stored.firstRowY ?? 150,
      curve: !!stored.curve,
    };
  }
  const rows = groupByRow(existing);
  const rowLengths = Array.from(rows.values()).map((r) => r.length);
  const perRow = rowLengths.length > 0 ? Math.max(1, rowLengths.reduce((a, b) => Math.max(a, b), 1)) : 1;
  const xs = existing.map((s) => s.x);
  const minX = xs.length > 0 ? xs.reduce((a, b) => Math.min(a, b), Infinity) : 0;
  const maxX = xs.length > 0 ? xs.reduce((a, b) => Math.max(a, b), -Infinity) : 0;
  const ys = existing.map((s) => s.y);
  const firstRowY = ys.length > 0 ? ys.reduce((a, b) => Math.min(a, b), Infinity) : 150;
  return {
    seatsPerRow: perRow,
    seatSpacing: SEAT_SPACING,
    rowSpacing: 50,
    aisleGap: 0,
    cx: Math.round((minX + maxX) / 2),
    firstRowY,
    curve: false,
  };
}

/**
 * Seats to add so the layout grows by `add` seats. New seats join the rear-most tier: free slots
 * in the last row are filled first, then new rows are appended behind it. Existing seats are
 * never moved or renumbered.
 */
export function planExtension(existing: ExistingSeat[], layout: any, add: number): PlannedSeat[] {
  if (add <= 0) return [];
  if (existing.length === 0) throw new AppError(400, 'This venue has no seats to extend');

  const cfg = gridConfigFor(layout, existing);
  const rows = groupByRow(existing);
  const rear = existing.reduce((a, b) => (b.y > a.y || (b.y === a.y && b.x > a.x) ? b : a));
  const { tier, section } = rear;

  const out: PlannedSeat[] = [];

  // 1. Fill free slots in the rear row (only for generated grids, where slot positions are known)
  const rearRow = rows.get(rear.row) ?? [];
  if (layout?.generated && rearRow.length < cfg.seatsPerRow) {
    const used = new Set(rearRow.map((s) => s.number));
    const baseY = Math.min(...rearRow.map((s) => s.y));
    for (let num = 1; num <= cfg.seatsPerRow && out.length < add; num++) {
      if (used.has(num)) continue;
      const x = seatX(cfg, num);
      out.push({ section, row: rear.row, number: num, x, y: seatY(cfg, baseY, x), tier });
    }
  }

  // 2. Append new rows behind the last one
  const rowBase = new Map<string, number>();
  let maxIdx = -1;
  for (const [label, list] of rows) {
    const listYs = list.map((s) => s.y);
    const minY = listYs.length > 0 ? listYs.reduce((a, b) => Math.min(a, b), Infinity) : 0;
    rowBase.set(label, minY);
    maxIdx = Math.max(maxIdx, rowIndexOf(label));
  }
  if (maxIdx < 0) maxIdx = rows.size - 1;
  const baseValues = Array.from(rowBase.values());
  const maxBase = baseValues.length > 0 ? baseValues.reduce((a, b) => Math.max(a, b), -Infinity) : (cfg.firstRowY ?? 150);
  let baseY = maxBase + cfg.rowSpacing;
  let nextIdx = maxIdx + 1;
  while (out.length < add) {
    const inRow = Math.min(cfg.seatsPerRow, add - out.length);
    const label = rowLabel(nextIdx++);
    for (let num = 1; num <= inRow; num++) {
      const x = seatX(cfg, num);
      out.push({ section, row: label, number: num, x, y: seatY(cfg, baseY, x), tier });
    }
    baseY += cfg.rowSpacing;
  }
  return out;
}

// ---- shrinking an existing layout -------------------------------------------------------------

export interface ShrinkCandidate extends ExistingSeat {
  /** Sold or currently held: must never be removed. */
  protected: boolean;
}

/** Ids of the seats to remove: rear-most, highest-numbered unprotected seats first. */
export function planShrink(seats: ShrinkCandidate[], remove: number): string[] {
  if (remove <= 0) return [];
  const removable = seats
    .filter((s) => !s.protected)
    .sort((a, b) => {
      const byRow = rowIndexOf(b.row) - rowIndexOf(a.row);
      if (byRow !== 0) return byRow;
      if (b.y !== a.y) return b.y - a.y;
      return b.number - a.number;
    });
  if (removable.length < remove) {
    const minCapacity = seats.length - removable.length;
    throw new AppError(
      409,
      `Capacity can't go below ${minCapacity}: ${minCapacity} seat${minCapacity === 1 ? ' is' : 's are'} already sold or being held by customers.`,
      { code: 'CAPACITY_BELOW_BOOKED', minCapacity },
    );
  }
  return removable.slice(0, remove).map((s) => s.id);
}

/** Recompute layout metadata after seats were added or removed. */
export function refreshLayoutMeta(layout: any, seats: Array<{ y: number; tier: string }>, capacity: number) {
  const base = layout && typeof layout === 'object' ? { ...layout } : {};
  const maxY = seats.length ? Math.max(...seats.map((s) => s.y)) : 0;
  const counts: Record<string, number> = {};
  for (const s of seats) counts[s.tier] = (counts[s.tier] ?? 0) + 1;
  return {
    ...base,
    capacity,
    height: Math.max(base.height ?? 0, Math.round(maxY + 60)),
    ...(base.generated ? { tierCounts: counts } : {}),
  };
}
