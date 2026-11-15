import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { AppError } from '../errors';

export interface TokenPayload {
  userId: string;
  email: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '7d' });
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as TokenPayload;
    req.user = decoded;
  } catch {
    // Invalid or expired token, leave req.user undefined
  }

  next();
}

/** Loads the user behind the token and refreshes `req.user.role` from the database. */
async function loadCurrentUser(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, role: true },
  });

  if (!user) {
    const isProduction = config.NODE_ENV === 'production';
    res.clearCookie('token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
    });
    req.user = undefined;
    throw new AppError(401, 'Session invalid or account no longer exists. Please sign in again.');
  }

  req.user!.role = user.role;
  return user;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError(401, 'Authentication required'));
  }

  loadCurrentUser(req, res)
    .then(() => next())
    .catch(next);
}

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Authentication required'));
    }

    // requireAuth has already verified the user and refreshed the role from the database
    // (the role inside the JWT can be stale), so there is nothing left to look up.
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(403, 'Permission denied'));
    }
    next();
  };
}
