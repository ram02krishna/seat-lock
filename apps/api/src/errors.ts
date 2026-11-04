import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

export class AppError extends Error {
  statusCode: number;
  /** Extra machine-readable fields merged into the JSON error body (e.g. `code`, `impact`). */
  details?: Record<string, unknown>;

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found' });
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ ...(err.details ?? {}), error: err.message });
  }

  // Malformed JSON / oversized bodies are the client's fault (body-parser sets status + type)
  const parserError = err as Error & { status?: number; type?: string };
  if (parserError.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (parserError.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }

  // Requests from an origin that is not on the allow-list
  if (err.message.startsWith('Origin ') && err.message.endsWith('not allowed by CORS')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  logger.error(err, 'Unhandled error');
  return res.status(500).json({ error: 'Internal server error' });
}
