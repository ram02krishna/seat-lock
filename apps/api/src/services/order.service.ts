import crypto from 'crypto';
import qrcode from 'qrcode';
import { prisma } from '../db';
import { AppError } from '../errors';
import { logger } from '../logger';
import { broadcastSeatsSold } from '../socket';
import { sendTicketConfirmationEmail } from './email.service';
import { redisConnection } from '../redis';

/**
 * Finalizes an order by marking held seats as SOLD and creating Ticket records.
 * Designed as a single function so a payment webhook or direct checkout can invoke it.
 */
export async function finalizeOrder(orderId: string, seatIds?: string[]) {
  const finalized = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        event: { include: { venue: true } },
        show: true,
        user: true,
        tickets: {
          include: {
            eventSeat: { include: { seat: true } },
          },
        },
      },
    });

    if (!order) {
      throw new AppError(404, 'Order not found');
    }

    // Idempotency: if already confirmed, return existing tickets
    if (order.status === 'CONFIRMED') {
      return {
        order,
        show: order.show,
        tickets: order.tickets,
        user: order.user,
        event: order.event,
        alreadyConfirmed: true,
      };
    }

    if (order.status !== 'PENDING') {
      throw new AppError(400, `Cannot finalize order with status ${order.status}`);
    }

    // Find the held event seats for this user and event
    const heldSeats = await tx.eventSeat.findMany({
      where: {
        eventId: order.eventId,
        heldByUserId: order.userId,
        status: 'HELD',
        holdExpiresAt: { gt: new Date() },
        ...(seatIds && seatIds.length > 0
          ? {
              OR: [
                { seatId: { in: seatIds } },
                { id: { in: seatIds } },
              ],
            }
          : {}),
      },
      include: { seat: true },
    });

    if (heldSeats.length === 0) {
      throw new AppError(400, 'No active held seats found to confirm');
    }

    // The order total was priced for exactly the seats requested. If any hold lapsed in the
    // meantime, fail the whole order rather than quietly issuing fewer tickets for the same price.
    if (seatIds && seatIds.length > 0) {
      const requested = new Set(seatIds).size;
      if (heldSeats.length !== requested) {
        throw new AppError(409, 'One or more seat holds expired before confirmation');
      }
    }

    // Mark seats SOLD
    const updateResult = await tx.eventSeat.updateMany({
      where: {
        id: { in: heldSeats.map((s) => s.id) },
        status: 'HELD',
        heldByUserId: order.userId,
        // Re-check the deadline in the atomic update too; a hold can expire between the
        // initial read and the state transition to SOLD.
        holdExpiresAt: { gt: new Date() },
      },
      data: {
        status: 'SOLD',
        heldByUserId: null,
        holdExpiresAt: null,
        version: { increment: 1 },
      },
    });

    if (updateResult.count !== heldSeats.length) {
      throw new AppError(409, 'One or more seat holds expired before confirmation');
    }

    // Update order status to CONFIRMED
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { status: 'CONFIRMED' },
    });

    // Generate unique tickets with cryptographic QR tokens
    const createdTickets = await Promise.all(
      heldSeats.map((es) =>
        tx.ticket.create({
          data: {
            orderId: order.id,
            eventSeatId: es.id,
            qrToken: crypto.randomUUID(),
          },
          include: {
            eventSeat: { include: { seat: true } },
          },
        })
      )
    );

    return {
      order: updatedOrder,
      show: order.show,
      tickets: createdTickets,
      user: order.user,
      event: order.event,
      alreadyConfirmed: false,
    };
  });

  // Generate QR code base64 Data URLs
  const ticketsWithQRs = await Promise.all(
    finalized.tickets.map(async (t) => {
      const qrDataUrl = await qrcode.toDataURL(t.qrToken, { width: 300, margin: 2 });
      return {
        id: t.id,
        orderId: t.orderId,
        eventSeatId: t.eventSeatId,
        qrToken: t.qrToken,
        checkedInAt: t.checkedInAt,
        createdAt: t.createdAt,
        seat: t.eventSeat.seat,
        price: t.eventSeat.price,
        qrDataUrl,
      };
    })
  );

  // If this was a fresh confirmation, broadcast real-time event and send email
  if (!finalized.alreadyConfirmed) {
    broadcastSeatsSold(finalized.order.eventId, {
      seatIds: finalized.tickets.map((t) => t.eventSeat.seatId),
      showId: finalized.order.showId || undefined,
    });

    redisConnection.del('cache:events:published').catch(() => null);

    const emailStartsAt = finalized.show?.startsAt ?? finalized.event.startsAt;

    sendTicketConfirmationEmail({
      toEmail: finalized.user.email,
      orderId: finalized.order.id,
      eventTitle: finalized.event.title,
      startsAt: emailStartsAt,
      venueName: finalized.event.venue.name,
      tickets: ticketsWithQRs.map((t) => ({
        ticketId: t.id,
        qrToken: t.qrToken,
        seatLabel: `Row ${t.seat.row}, Seat ${t.seat.number}`,
        tier: t.seat.tier,
        priceCents: t.price,
        qrDataUrl: t.qrDataUrl,
      })),
    }).catch((err) => logger.error(err, 'Error in sendTicketConfirmationEmail'));
  }

  return {
    order: finalized.order,
    tickets: ticketsWithQRs,
  };
}

export async function createAndConfirmBooking(params: {
  eventId: string;
  seatIds: string[];
  userId: string;
  showId?: string;
  idempotencyKey?: string;
}) {
  const { eventId, seatIds, userId, showId, idempotencyKey } = params;
  const uniqueSeatIds = [...new Set(seatIds)];

  if (uniqueSeatIds.length === 0) {
    throw new AppError(400, 'Please select at least one seat');
  }

  // 1. Idempotency Key check: if an order already exists with this key, return it
  if (idempotencyKey) {
    const existingOrder = await prisma.order.findUnique({
      where: { idempotencyKey },
    });

    if (existingOrder) {
      // A key is only a replay for the user who created it. Without this check anyone who learned
      // or guessed a key could read another customer's order and QR codes.
      if (existingOrder.userId !== userId || existingOrder.eventId !== eventId) {
        throw new AppError(409, 'This request was already used. Please try again.');
      }
      if (existingOrder.status === 'CANCELLED') {
        throw new AppError(409, 'This booking attempt failed earlier. Please try again.');
      }
      logger.info(`Idempotent order replay for key ${idempotencyKey}`);
      return finalizeOrder(existingOrder.id, uniqueSeatIds);
    }
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { status: true, startsAt: true } });
  if (!event || event.status !== 'PUBLISHED') {
    throw new AppError(404, 'Event not found or not open for booking');
  }

  // If show is specified, verify show exists and is in future
  if (showId) {
    const show = await prisma.show.findUnique({ where: { id: showId } });
    if (!show || show.eventId !== eventId) {
      throw new AppError(404, 'Show not found');
    }
    if (show.startsAt.getTime() <= Date.now()) {
      throw new AppError(400, 'This show has already started');
    }
  } else if (event.startsAt.getTime() <= Date.now()) {
    throw new AppError(400, 'This event has already started');
  }

  // 2. Verify seats are currently HELD by this user
  const heldSeats = await prisma.eventSeat.findMany({
    where: {
      eventId,
      ...(showId ? { showId } : {}),
      heldByUserId: userId,
      status: 'HELD',
      holdExpiresAt: { gt: new Date() },
      OR: [
        { seatId: { in: uniqueSeatIds } },
        { id: { in: uniqueSeatIds } },
      ],
    },
  });

  if (heldSeats.length !== uniqueSeatIds.length) {
    throw new AppError(400, 'All seats must be actively held by you before confirming booking');
  }

  const totalCents = heldSeats.reduce((sum, s) => sum + s.price, 0);

  // 3. Create PENDING Order
  const order = await prisma.order.create({
    data: {
      userId,
      eventId,
      showId: showId || null,
      status: 'PENDING',
      totalCents,
      idempotencyKey: idempotencyKey || null,
    },
  });

  // 4. Finalize order (mark SOLD + create tickets). If it can't be completed, close the order so
  //    failed attempts don't pile up as PENDING rows (and the idempotency key can't be replayed).
  try {
    return await finalizeOrder(order.id, uniqueSeatIds);
  } catch (err) {
    await prisma.order
      .updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
      .catch((cleanupErr) => logger.error(cleanupErr, 'Failed to cancel unfinished order'));
    throw err;
  }
}
