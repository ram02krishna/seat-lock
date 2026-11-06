import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Limits requests per client IP and route using an in-memory fixed window.
 * Each API process has its own limits; this still helps slow automated login attempts and code guessing.
 */
export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const buckets = new Map<string, Bucket>();

  // Remove expired entries so the map stays bounded.
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
