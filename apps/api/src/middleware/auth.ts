import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { config } from '../config';
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

import { prisma } from '../db';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError(401, 'Authentication required'));
  }

  prisma.user
    .findUnique({
      where: { id: req.user.userId },
      select: { id: true, role: true },
    })
    .then((userExists) => {
      if (!userExists) {
        const isProduction = config.NODE_ENV === 'production';
        res.clearCookie('token', {
          httpOnly: true,
          secure: isProduction,
          sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
        });
        req.user = undefined;
        return next(
          new AppError(401, 'Session invalid or account no longer exists. Please sign in again.')
        );
      }

      req.user!.role = userExists.role;
      next();
    })
    .catch((err) => next(err));
}

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Authentication required'));
    }

    // If requireAuth has already verified the user and attached the role, reuse it
    if (req.user.role) {
      if (!allowedRoles.includes(req.user.role)) {
        return next(new AppError(403, 'Permission denied'));
      }
      return next();
    }

    prisma.user
      .findUnique({
        where: { id: req.user.userId },
        select: { id: true, role: true },
      })
      .then((userExists) => {
        if (!userExists) {
          const isProduction = config.NODE_ENV === 'production';
          res.clearCookie('token', {
            httpOnly: true,
            secure: isProduction,
            sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
          });
          req.user = undefined;
          return next(
            new AppError(401, 'Session invalid or account no longer exists. Please sign in again.')
          );
        }

        req.user!.role = userExists.role;

        if (!allowedRoles.includes(userExists.role)) {
          return next(new AppError(403, 'Permission denied'));
        }

        next();
      })
      .catch((err) => next(err));
  };
}
