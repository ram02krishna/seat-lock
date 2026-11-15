import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '../errors';

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const error = result.error as ZodError;
      const message = error.issues[0]?.message || 'Invalid request body';
      return next(new AppError(400, message));
    }
    req.body = result.data;
    next();
  };
}
