import type { SeatItem } from '@/store/cartStore';

interface ServerSeat {
  id: string;
  seatId: string;
  section: string;
  row: string;
  number: number;
  tier: string;
  price: number;
  status: string;
  isHeldByMe: boolean;
  holdExpiresAt: string | null;
}

/** The seats the signed-in user currently holds (and when the earliest hold lapses), per the server. */
export function deriveMyHold(seats: ServerSeat[] | undefined): { seats: SeatItem[]; expiresAt: string } | null {
  if (!seats) return null;
  const now = Date.now();
  const mine = seats.filter(
    (s) => s.status === 'HELD' && s.isHeldByMe && s.holdExpiresAt && new Date(s.holdExpiresAt).getTime() > now,
  );
  if (mine.length === 0) return null;

  const expiresAt = mine.reduce((min, s) => (s.holdExpiresAt! < min ? s.holdExpiresAt! : min), mine[0]!.holdExpiresAt!);
  return {
    expiresAt,
    seats: mine.map((s) => ({
      id: s.id,
      seatId: s.seatId,
      section: s.section,
      row: s.row,
      number: s.number,
      tier: s.tier,
      price: s.price,
    })),
  };
}
