import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { CheckInSchema } from '@repo/shared';
import { AppError } from '../errors';
import { Role } from '@prisma/client';

export const ticketsRouter = Router();

// Staff check-in endpoint (Atomic conditional update)
ticketsRouter.post(
  '/check-in',
  requireAuth,
  requireRole([Role.STAFF, Role.ORGANIZER]),
  validateBody(CheckInSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { qrToken } = req.body;

      let cleanToken = qrToken.trim();
      // Extract token if scanned as URL or query parameter
      if (cleanToken.includes('token=')) {
        const match = cleanToken.match(/token=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) cleanToken = match[1];
      } else if (cleanToken.includes('/')) {
        const parts = cleanToken.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.length >= 8) cleanToken = lastPart;
      }

      // 1. Find ticket with order and attendee details (supports both qrToken and ticket id)
      const ticket = await prisma.ticket.findFirst({
        where: {
          OR: [
            { qrToken: cleanToken },
            { id: cleanToken },
          ],
        },
        include: {
          order: {
            include: { user: true },
          },
          eventSeat: {
            include: {
              seat: true,
              event: {
                include: { venue: true },
              },
            },
          },
        },
      });

      if (!ticket) {
        return next(new AppError(404, 'Invalid ticket: QR code or token not recognized'));
      }

      if (ticket.eventSeat.event.status === 'CANCELLED') {
        return next(new AppError(400, 'This event has been cancelled'));
      }

      const attendee = {
        email: ticket.order.user.email,
        eventTitle: ticket.eventSeat.event.title,
        venue: ticket.eventSeat.event.venue.name,
        seat: `Row ${ticket.eventSeat.seat.row}, Seat ${ticket.eventSeat.seat.number}`,
        tier: ticket.eventSeat.seat.tier,
      };

      // 2. Immediate check if already used
      if (ticket.checkedInAt) {
        return res.status(409).json({ error: 'Ticket already used', checkedInAt: ticket.checkedInAt, attendee });
      }

      // 3. Atomic conditional update: set checkedInAt ONLY WHERE it is still null
      const updated = await prisma.$queryRaw<Array<{ id: string; checkedInAt: Date }>>`
        UPDATE "Ticket"
        SET "checkedInAt" = NOW(), "updatedAt" = NOW()
        WHERE id = ${ticket.id} AND "checkedInAt" IS NULL
        RETURNING id, "checkedInAt";
      `;

      if (updated.length === 0) {
        // Concurrently checked in at another gate
        const recheck = await prisma.ticket.findUnique({ where: { id: ticket.id } });
        return res.status(409).json({ error: 'Ticket already used', checkedInAt: recheck?.checkedInAt, attendee });
      }

      return res.status(200).json({
        message: 'Check-in successful',
        ticketId: ticket.id,
        checkedInAt: updated[0]!.checkedInAt,
        attendee,
      });
    } catch (err) {
      next(err);
    }
  }
);
