import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small fixed-window limiter, keyed by client IP + route. In-memory, so it is per-instance,
 * which is fine for a single API process and still blunts credential stuffing(Makes automated attempts to log in using stolen username/password combinations harder) and code guessing.
 */
export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const buckets = new Map<string, Bucket>();

  // Keep the map from growing forever
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, options.windowMs).unref();

  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      return next(new AppError(429, options.message ?? 'Too many attempts. Please wait a moment and try again.'));
    }
    next();
  };
}
