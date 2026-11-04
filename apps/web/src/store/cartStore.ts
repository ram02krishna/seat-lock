import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface SeatItem {
  id: string; // EventSeat id
  seatId: string;
  section: string;
  row: string;
  number: number;
  tier: string;
  price: number;
}

interface CartState {
  eventId: string | null;
  showId: string | null;
  showStartsAt: string | null;
  selectedSeats: SeatItem[];
  heldSeatIds: string[];
  holdExpiresAt: string | null;
  setEventId: (eventId: string | null) => void;
  setShowId: (showId: string | null, showStartsAt?: string | null) => void;
  toggleSeat: (seat: SeatItem) => { success: boolean; error?: string };
  clearSelection: () => void;
  removeSeats: (ids: string[]) => void;
  setHeldSeats: (seatIds: string[], expiresAt: string, eventId?: string, showId?: string) => void;
  restoreHold: (eventId: string, seats: SeatItem[], expiresAt: string, showId?: string, showStartsAt?: string) => void;
  clearHold: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      eventId: null,
      showId: null,
      showStartsAt: null,
      selectedSeats: [],
      heldSeatIds: [],
      holdExpiresAt: null,

      setEventId: (eventId) => {
        const { eventId: currentEventId, heldSeatIds, holdExpiresAt } = get();

        // The cart only ever describes the event being viewed. Switching events drops the local
        // selection; any server-side hold stays put and is restored from the API when relevant.
        if (currentEventId !== eventId) {
          set({ eventId, showId: null, showStartsAt: null, selectedSeats: [], heldSeatIds: [], holdExpiresAt: null });
          return;
        }

        // Same event: drop a hold that has already lapsed
        if (heldSeatIds.length > 0 && holdExpiresAt && new Date(holdExpiresAt) <= new Date()) {
          set({ selectedSeats: [], heldSeatIds: [], holdExpiresAt: null });
        }
      },

      setShowId: (showId, showStartsAt = null) => {
        const { showId: currentShowId } = get();
        if (currentShowId !== showId) {
          set({ showId, showStartsAt, selectedSeats: [] });
        }
      },

      toggleSeat: (seat) => {
        const { selectedSeats, heldSeatIds, holdExpiresAt } = get();
        const holdExpired =
          heldSeatIds.length > 0 && !!holdExpiresAt && new Date(holdExpiresAt) <= new Date();
        const currentSelection = holdExpired ? [] : selectedSeats;

        if (holdExpired) {
          // Expired seats may already have been taken by someone else; don't keep them in the cart.
          set({ selectedSeats: [], heldSeatIds: [], holdExpiresAt: null });
        } else if (heldSeatIds.length > 0) {
          return {
            success: false,
            error: 'You have active held seats. Confirm or release them first.',
          };
        }

        const exists = currentSelection.some((s) => s.id === seat.id || s.seatId === seat.seatId);
        if (exists) {
          set({
            selectedSeats: currentSelection.filter(
              (s) => s.id !== seat.id && s.seatId !== seat.seatId
            ),
          });
          return { success: true };
        }

        if (currentSelection.length >= 6) {
          return { success: false, error: 'Maximum 6 seats per booking' };
        }

        set({ selectedSeats: [...currentSelection, seat] });
        return { success: true };
      },

      clearSelection: () => set({ selectedSeats: [] }),

      removeSeats: (ids) =>
        set((state) => ({
          selectedSeats: state.selectedSeats.filter((s) => !ids.includes(s.id)),
        })),

      setHeldSeats: (seatIds, expiresAt, eventId, showId) =>
        set((state) => ({
          heldSeatIds: seatIds,
          holdExpiresAt: expiresAt,
          eventId: eventId || state.eventId,
          showId: showId || state.showId,
        })),

      restoreHold: (eventId, seats, expiresAt, showId, showStartsAt) =>
        set({
          eventId,
          showId: showId || null,
          showStartsAt: showStartsAt || null,
          selectedSeats: seats,
          heldSeatIds: seats.map((s) => s.id),
          holdExpiresAt: expiresAt,
        }),

      clearHold: () =>
        set({
          selectedSeats: [],
          heldSeatIds: [],
          holdExpiresAt: null,
        }),
    }),
    {
      name: 'event-seat-cart',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
