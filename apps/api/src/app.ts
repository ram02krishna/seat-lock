import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './errors';
import { HealthResponse } from '@repo/shared';
import { attachUser } from './middleware/auth';
import { authRouter } from './routes/auth.routes';
import { eventsRouter } from './routes/events.routes';
import { organizerRouter } from './routes/organizer.routes';
import { ordersRouter } from './routes/orders.routes';
import { ticketsRouter } from './routes/tickets.routes';
import { isOriginAllowed } from './cors';
import { prisma } from './db';
import { redisConnection } from './redis';

export const app = express();

// Behind a hosting proxy; needed for correct client IPs (rate limiting, logs)
app.set('trust proxy', 1);

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  })
);

app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Health check (supports ?deep=true for DB and Redis status)
app.get('/health', async (req, res) => {
  const isDeep = req.query.deep === 'true';
  let dbStatus = 'ok';
  let redisStatus = 'ok';

  if (isDeep) {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }
    try {
      await redisConnection.ping();
    } catch {
      redisStatus = 'error';
    }
  }

  const isHealthy = dbStatus === 'ok' && redisStatus === 'ok';
  const data: HealthResponse = {
    status: isHealthy ? 'ok' : 'error',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    ...(isDeep ? { db: dbStatus, redis: redisStatus } : {}),
  };
  res.status(isHealthy ? 200 : 503).json(data);
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);
app.use('/api/organizer', organizerRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/tickets', ticketsRouter);

// 404 & error handlers
app.use(notFoundHandler);
app.use(errorHandler);
