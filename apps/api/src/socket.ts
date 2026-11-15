import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { logger } from './logger';
import { isOriginAllowed } from './cors';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
      },
      credentials: true,
    },
  });

  io.on('connection', (socket: Socket) => {
    logger.info(`Client connected to socket: ${socket.id}`);

    // Join room for specific event
    socket.on('join:event', (eventId: unknown) => {
      if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 64) return;
      socket.join(`event:${eventId}`);
      logger.info(`Socket ${socket.id} joined room event:${eventId}`);
    });

    // Leave event room
    socket.on('leave:event', (eventId: unknown) => {
      if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 64) return;
      socket.leave(`event:${eventId}`);
      logger.info(`Socket ${socket.id} left room event:${eventId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.IO has not been initialized');
  }
  return io;
}

export function broadcastSeatsHeld(eventId: string, data: { seatIds: string[]; heldByUserId: string; holdExpiresAt: string; showId?: string }) {
  if (io) {
    io.to(`event:${eventId}`).emit('seats:held', data);
  }
}

export function broadcastSeatsReleased(eventId: string, data: { seatIds: string[]; showId?: string }) {
  if (io) {
    io.to(`event:${eventId}`).emit('seats:released', data);
  }
}

export function broadcastSeatsSold(eventId: string, data: { seatIds: string[]; showId?: string }) {
  if (io) {
    io.to(`event:${eventId}`).emit('seats:sold', data);
  }
}

/** Tells everyone viewing an event that its details or seat layout changed and should be refetched. */
export function broadcastEventUpdated(eventId: string) {
  if (io) {
    io.to(`event:${eventId}`).emit('event:updated', { eventId });
  }
}

/** Tells everyone viewing an event that it was deleted by the organizer. */
export function broadcastEventDeleted(eventId: string) {
  if (io) {
    io.to(`event:${eventId}`).emit('event:deleted', { eventId });
  }
}
