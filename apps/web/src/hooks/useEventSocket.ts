'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { SeatData } from '@/components/seat-map/SeatMap';

const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').trim().replace(/\/+$/, '');

let sharedSocket: Socket | null = null;

function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 500,
    });
  }
  return sharedSocket;
}

interface SeatPayload {
  seatIds: string[];
  heldByUserId?: string;
  holdExpiresAt?: string;
}

export function useEventSocket(eventId: string) {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!eventId) return;

    const socket = getSharedSocket();
    socketRef.current = socket;

    const joinRoom = () => {
      socket.emit('join:event', eventId);
    };

    // 'connect' fires on the first connection and on every reconnect, so this covers both
    if (socket.connected) joinRoom();
    socket.on('connect', joinRoom);

    // Anything that happened while we were disconnected was missed, so refetch on reconnect
    const handleReconnect = () => {
      queryClient.invalidateQueries({ queryKey: ['events', eventId, 'seats'] });
    };

    socket.io.on('reconnect', handleReconnect);

    // Real-time seat updates
    const onSeatsHeld = (data: SeatPayload) => {
      // Work out whether this hold is ours, so our own seats never render as "held by someone else"
      const me = queryClient.getQueryData<{ user?: { id: string } }>(['auth', 'me'])?.user?.id;
      const mine = !!me && data.heldByUserId === me;
      queryClient.setQueryData(
        ['events', eventId, 'seats'],
        (old: { eventId: string; venue: any; seats: SeatData[] } | undefined) => {
          if (!old) return old;
          const heldSet = new Set(data.seatIds);
          return {
            ...old,
            seats: old.seats.map((seat) => {
              if (heldSet.has(seat.seatId) || heldSet.has(seat.id)) {
                return {
                  ...seat,
                  status: 'HELD' as const,
                  isHeldByMe: mine,
                  holdExpiresAt: data.holdExpiresAt || null,
                };
              }
              return seat;
            }),
          };
        }
      );
    };

    const onSeatsReleased = (data: SeatPayload) => {
      queryClient.setQueryData(
        ['events', eventId, 'seats'],
        (old: { eventId: string; venue: any; seats: SeatData[] } | undefined) => {
          if (!old) return old;
          const releasedSet = new Set(data.seatIds);
          return {
            ...old,
            seats: old.seats.map((seat) => {
              if (releasedSet.has(seat.seatId) || releasedSet.has(seat.id)) {
                return {
                  ...seat,
                  status: 'AVAILABLE' as const,
                  isHeldByMe: false,
                  holdExpiresAt: null,
                };
              }
              return seat;
            }),
          };
        }
      );
    };

    const onSeatsSold = (data: SeatPayload) => {
      queryClient.setQueryData(
        ['events', eventId, 'seats'],
        (old: { eventId: string; venue: any; seats: SeatData[] } | undefined) => {
          if (!old) return old;
          const soldSet = new Set(data.seatIds);
          return {
            ...old,
            seats: old.seats.map((seat) => {
              if (soldSet.has(seat.seatId) || soldSet.has(seat.id)) {
                return {
                  ...seat,
                  status: 'SOLD' as const,
                  isHeldByMe: false,
                  holdExpiresAt: null,
                };
              }
              return seat;
            }),
          };
        }
      );
    };

    // The organizer edited the event (capacity, prices, date...): reload the seat map and listings
    const onEventUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['events', eventId, 'seats'] });
      queryClient.invalidateQueries({ queryKey: ['events'], exact: true });
    };

    socket.on('event:updated', onEventUpdated);
    socket.on('seats:held', onSeatsHeld);
    socket.on('seats:released', onSeatsReleased);
    socket.on('seats:sold', onSeatsSold);

    return () => {
      socket.off('connect', joinRoom);
      socket.io.off('reconnect', handleReconnect);
      socket.off('event:updated', onEventUpdated);
      socket.off('seats:held', onSeatsHeld);
      socket.off('seats:released', onSeatsReleased);
      socket.off('seats:sold', onSeatsSold);
      socket.emit('leave:event', eventId);
    };
  }, [eventId, queryClient]);

  return socketRef.current;
}
