import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { validateBody } from '../middleware/validate';
import {
  LoginSchema,
  SendOtpRegisterSchema,
  VerifyOtpRegisterSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from '@repo/shared';
import { AppError } from '../errors';
import { signToken, requireAuth } from '../middleware/auth';
import { config } from '../config';
import { Role } from '@prisma/client';
import { redisConnection } from '../redis';
import { sendOtpEmail } from '../services/email.service';
import { rateLimit } from '../middleware/rateLimit';

export const authRouter = Router();

const isProduction = config.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Cryptographically secure 6-digit code (Math.random is predictable)
function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

const MAX_OTP_ATTEMPTS = 5;

// Valid bcrypt hash of a random string, only used to equalise login timing for unknown emails
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Count a wrong guess against a code. After MAX_OTP_ATTEMPTS the code is destroyed, so a
 * 6-digit code can't be brute-forced inside its 10 minute lifetime.
 */
async function registerFailedAttempt(codeKey: string): Promise<void> {
  const attemptsKey = `${codeKey}:attempts`;
  const attempts = await redisConnection.incr(attemptsKey);
  if (attempts === 1) await redisConnection.expire(attemptsKey, 600);
  if (attempts >= MAX_OTP_ATTEMPTS) {
    await redisConnection.del(codeKey, attemptsKey);
  }
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const codeSendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, message: 'Too many codes requested. Try again in a few minutes.' });
// Reads (/me) and logout are called constantly by the UI; only throttle the credential-handling routes
authRouter.use((req, res, next) =>
  req.method === 'GET' || req.path === '/logout' ? next() : authLimiter(req, res, next),
);

// 1. Send OTP for Registration
authRouter.post(
  '/register/send-otp',
  codeSendLimiter,
  validateBody(SendOtpRegisterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const { password } = req.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return next(new AppError(409, 'Email already registered. Please sign in instead.'));
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const otp = generateOtp();

      // Store in Redis with 10 minute expiry (600s)
      await redisConnection.setex(
        `reg_otp:${email}`,
        600,
        JSON.stringify({ otp, passwordHash })
      );

      const emailResult = await sendOtpEmail({
        toEmail: email,
        otp,
        purpose: 'signup',
      });

      const responsePayload: { message: string; email: string; devOtp?: string } = {
        message: 'Verification code sent to your email',
        email,
      };

      if (!isProduction) {
        responsePayload.devOtp = otp;
        if (!emailResult.success) {
          responsePayload.message = `[Dev Mode] Verification code is ${otp} (Email not sent: ${emailResult.error || 'Resend sandbox restricted'})`;
        }
      } else if (!emailResult.success) {
        if (emailResult.isSandboxRestriction) {
          return next(
            new AppError(
              403,
              'Resend Sandbox restriction: Test emails can only be sent to the verified Resend account owner email. To send to any recipient, verify your domain at resend.com/domains or configure RESEND_FROM_EMAIL.'
            )
          );
        }
        return next(
          new AppError(
            500,
            `Unable to send verification email: ${emailResult.error || 'Email service error'}. Please try again later.`
          )
        );
      }

      return res.status(200).json(responsePayload);
    } catch (err) {
      next(err);
    }
  }
);

// 2. Verify OTP & Complete Registration
authRouter.post(
  '/register/verify-otp',
  validateBody(VerifyOtpRegisterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const { otp } = req.body;

      const cachedData = await redisConnection.get(`reg_otp:${email}`);
      if (!cachedData) {
        return next(
          new AppError(400, 'Verification code expired or not found. Please request a new code.')
        );
      }

      const { otp: storedOtp, passwordHash } = JSON.parse(cachedData);
      if (!codesMatch(storedOtp, otp)) {
        await registerFailedAttempt(`reg_otp:${email}`);
        return next(new AppError(400, 'Invalid verification code. Please check and try again.'));
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        await redisConnection.del(`reg_otp:${email}`);
        return next(new AppError(409, 'Email already registered. Please sign in.'));
      }

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: Role.CUSTOMER,
        },
      });

      await redisConnection.del(`reg_otp:${email}`);

      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      res.cookie('token', token, COOKIE_OPTIONS);
      return res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        message: 'Account verified and created successfully',
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Forgot Password - Send OTP
authRouter.post(
  '/forgot-password',
  codeSendLimiter,
  validateBody(ForgotPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.body.email.trim().toLowerCase();

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return next(
          new AppError(404, 'Account with this email does not exist. Please create an account first.')
        );
      }

      const otp = generateOtp();
      await redisConnection.setex(
        `pwd_reset:${email}`,
        600,
        JSON.stringify({ otp, userId: user.id })
      );

      const emailResult = await sendOtpEmail({
        toEmail: email,
        otp,
        purpose: 'reset',
      });

      const responsePayload: { message: string; email: string; devOtp?: string } = {
        message: 'Password reset code sent to your email',
        email,
      };

      if (!isProduction) {
        responsePayload.devOtp = otp;
        if (!emailResult.success) {
          responsePayload.message = `[Dev Mode] Password reset code is ${otp} (Email not sent: ${emailResult.error || 'Resend sandbox restricted'})`;
        }
      } else if (!emailResult.success) {
        if (emailResult.isSandboxRestriction) {
          return next(
            new AppError(
              403,
              'Resend Sandbox restriction: Test emails can only be sent to the verified Resend account owner email. To send to any recipient, verify your domain at resend.com/domains or configure RESEND_FROM_EMAIL.'
            )
          );
        }
        return next(
          new AppError(
            500,
            `Unable to send reset email: ${emailResult.error || 'Email service error'}. Please try again later.`
          )
        );
      }

      return res.status(200).json(responsePayload);
    } catch (err) {
      next(err);
    }
  }
);

// 4. Reset Password with OTP
authRouter.post(
  '/reset-password',
  validateBody(ResetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const { otp, newPassword } = req.body;

      const cached = await redisConnection.get(`pwd_reset:${email}`);
      if (!cached) {
        return next(
          new AppError(400, 'Reset code expired or not found. Please request a new code.')
        );
      }

      const { otp: storedOtp } = JSON.parse(cached);
      if (!codesMatch(storedOtp, otp)) {
        await registerFailedAttempt(`pwd_reset:${email}`);
        return next(new AppError(400, 'Invalid verification code. Please check and try again.'));
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      let updatedUser;
      try {
        updatedUser = await prisma.user.update({
          where: { email },
          data: { passwordHash },
        });
      } catch (err: any) {
        if (err.code === 'P2025') {
          return next(new AppError(404, 'Account no longer exists. Please sign in or register.'));
        }
        throw err;
      }

      await redisConnection.del(`pwd_reset:${email}`);

      const token = signToken({
        userId: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
      });

      res.cookie('token', token, COOKIE_OPTIONS);
      return res.status(200).json({
        message: 'Password successfully reset. You are now signed in.',
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Login
authRouter.post(
  '/login',
  validateBody(LoginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const { password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        // Spend the same time as a real check so response timing doesn't reveal which emails exist
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        return next(new AppError(401, 'Invalid email or password'));
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return next(new AppError(401, 'Invalid email or password'));
      }

      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      res.cookie('token', token, COOKIE_OPTIONS);
      return res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Logout
authRouter.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', COOKIE_OPTIONS);
  return res.status(200).json({ message: 'Logged out successfully' });
});

// Current user profile
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    if (!user) {
      return next(new AppError(404, 'User not found'));
    }

    return res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
});
