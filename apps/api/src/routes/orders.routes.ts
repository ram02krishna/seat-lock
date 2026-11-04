import { Router, Request, Response, NextFunction } from 'express';
import qrcode from 'qrcode';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { ConfirmOrderSchema } from '@repo/shared';
import { createAndConfirmBooking } from '../services/order.service';
import { redisConnection } from '../redis';

export const ordersRouter = Router();

// Confirm booking & generate tickets
ordersRouter.post(
  '/confirm',
  requireAuth,
  validateBody(ConfirmOrderSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { eventId, seatIds, showId, idempotencyKey } = req.body;
      const userId = req.user!.userId;

      const result = await createAndConfirmBooking({
        eventId,
        seatIds,
        userId,
        showId,
        idempotencyKey,
      });

      redisConnection.del('cache:events:published').catch(() => null);

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// Bounded so a long-running process can't accumulate one entry per ticket ever viewed
const QR_CACHE_MAX = 500;
const qrCache = new Map<string, string>();

async function getOrGenerateQrDataUrl(qrToken: string): Promise<string> {
  const cached = qrCache.get(qrToken);
  if (cached) {
    // refresh recency
    qrCache.delete(qrToken);
    qrCache.set(qrToken, cached);
    return cached;
  }

  const dataUrl = await qrcode.toDataURL(qrToken, { width: 220, margin: 1 });
  qrCache.set(qrToken, dataUrl);
  if (qrCache.size > QR_CACHE_MAX) {
    const oldest = qrCache.keys().next().value;
    if (oldest !== undefined) qrCache.delete(oldest);
  }
  return dataUrl;
}

// Get current user's tickets
ordersRouter.get('/my-tickets', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const orders = await prisma.order.findMany({
      where: { userId, status: 'CONFIRMED' },
      include: {
        event: {
          include: { venue: true },
        },
        show: true,
        tickets: {
          include: {
            eventSeat: {
              include: { seat: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ordersWithQRs = await Promise.all(
      orders.map(async (order) => {
        const ticketsWithQRs = await Promise.all(
          order.tickets.map(async (t) => {
            const qrDataUrl = await getOrGenerateQrDataUrl(t.qrToken);
            return {
              id: t.id,
              qrToken: t.qrToken,
              checkedInAt: t.checkedInAt,
              seat: t.eventSeat.seat,
              price: t.eventSeat.price,
              qrDataUrl,
            };
          })
        );

        return {
          id: order.id,
          totalCents: order.totalCents,
          createdAt: order.createdAt,
          event: order.event,
          show: order.show ? { id: order.show.id, startsAt: order.show.startsAt } : null,
          tickets: ticketsWithQRs,
        };
      })
    );

    res.status(200).json({ orders: ordersWithQRs });
  } catch (err) {
    next(err);
  }
});
