import { z } from 'zod';

export const UserRoleSchema = z.enum(['CUSTOMER', 'ORGANIZER', 'STAFF']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const SeatStatusSchema = z.enum(['AVAILABLE', 'HELD', 'SOLD']);
export type SeatStatus = z.infer<typeof SeatStatusSchema>;

export const OrderStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export interface HealthResponse {
  status: 'ok' | 'error' | 'degraded';
  uptime: number;
  timestamp: string;
  db?: string;
  redis?: string;
}

// Auth schemas
export const CreateStaffSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type CreateStaffInput = z.infer<typeof CreateStaffSchema>;

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const SendOtpRegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type SendOtpRegisterInput = z.infer<typeof SendOtpRegisterSchema>;

export const VerifyOtpRegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'Verification code must be 6 digits'),
});
export type VerifyOtpRegisterInput = z.infer<typeof VerifyOtpRegisterSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'Verification code must be 6 digits'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export const VenueTypeEnum = z.enum([
  'THEATER_DOLBY',
  'CONFERENCE_HALL',
  'AUDITORIUM',
  'ARENA',
  'OTHERS',
]);
export type VenueType = z.infer<typeof VenueTypeEnum>;

// Organizer / Venue / Event schemas
export const CreateVenueSchema = z.object({
  name: z.string().min(2, 'Venue name is required'),
  layout: z.record(z.any()).optional(),
  venueType: VenueTypeEnum.optional(),
});
export type CreateVenueInput = z.infer<typeof CreateVenueSchema>;

export const GenerateSeatsSchema = z.object({
  sections: z.array(
    z.object({
      name: z.string(),
      tier: z.string(),
      rows: z.array(z.string()).min(1).max(100),
      seatsPerRow: z.number().int().positive().max(200),
      startY: z.number(),
      rowSpacing: z.number().default(50),
      startX: z.number(),
      seatSpacing: z.number().default(50),
      defaultPriceCents: z.number().int().positive(),
    })
  ),
});
export type GenerateSeatsInput = z.infer<typeof GenerateSeatsSchema>;

// ---- Event capacity / seating limits -------------------------------------------------------
export const MAX_SEATS_PER_EVENT = 2000;
export const MAX_SEATS_PER_ROW = 50;
export const PRICING_TIERS = ['VIP', 'PREMIUM', 'STANDARD'] as const;
export type PricingTier = (typeof PRICING_TIERS)[number];

const seatCountSchema = z
  .number({ invalid_type_error: 'Total seats must be a number' })
  .int('Total seats must be a whole number')
  .min(1, 'An event needs at least 1 seat')
  .max(MAX_SEATS_PER_EVENT, `An event can have at most ${MAX_SEATS_PER_EVENT} seats`);

const priceCentsSchema = z
  .number({ invalid_type_error: 'Price must be a number' })
  .int('Price must be a whole number of paise')
  .positive('Price must be above zero');

export const PricingSchema = z
  .object({
    VIP: priceCentsSchema.optional(),
    PREMIUM: priceCentsSchema.optional(),
    STANDARD: priceCentsSchema.optional(),
  })
  .strict();
export type PricingInput = z.infer<typeof PricingSchema>;

const httpUrlSchema = z
  .string()
  .trim()
  .max(2000, 'Image URL is too long')
  .url('Image must be a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), 'Image URL must start with http:// or https://');

/** Accepts a URL, or '' / null to clear it. */
const nullableImageSchema = z.union([
  z.literal('').transform(() => null),
  z.null(),
  httpUrlSchema,
]);

const nullableTextSchema = (max: number, label: string) =>
  z.union([
    z
      .string()
      .trim()
      .max(max, `${label} must be at most ${max} characters`)
      .transform((v) => (v === '' ? null : v)),
    z.null(),
  ]);

/** Cinema events are the only ones that have several independently-priced show timings. */
export const CINEMA_VENUE_TYPE = 'THEATER_DOLBY' as const;
export const isCinemaVenueType = (type: string | null | undefined): boolean => type === CINEMA_VENUE_TYPE;

export const CreateShowSchema = z.object({
  startsAt: z.string().datetime('Must be a valid ISO datetime string'),
  pricing: PricingSchema.optional(),
});
export type CreateShowInput = z.infer<typeof CreateShowSchema>;

export const UpdateShowSchema = z
  .object({
    startsAt: z.string().datetime('Must be a valid ISO datetime string').optional(),
    pricing: PricingSchema.optional(),
    /** Must be true to move a show that already has tickets sold; ticket holders are emailed. */
    confirm: z.boolean().optional(),
  })
  .refine((v) => v.startsAt !== undefined || v.pricing !== undefined, {
    message: 'Change the show time or its prices',
  });
export type UpdateShowInput = z.infer<typeof UpdateShowSchema>;

export const CreateEventSchema = z
  .object({
    /** @deprecated Seats are now generated per event from `totalSeats`; kept so old clients still validate. */
    venueId: z.string().optional(),
    venueName: z.string().trim().max(150).optional(),
    venueType: VenueTypeEnum.optional().default('THEATER_DOLBY'),
    category: z.string().trim().max(50).optional(),
    title: z.string().trim().min(2, 'Event title is required').max(150, 'Title must be at most 150 characters'),
    description: z.string().trim().max(5000, 'Description must be at most 5000 characters').optional(),
    /**
     * Required for every venue type except cinema. A cinema's date and time come from its show
     * timings (the event start is simply the earliest show), so cinema clients send `shows` only.
     */
    startsAt: z.string().datetime('Must be a valid ISO datetime string').optional(),
    location: nullableTextSchema(300, 'Location').optional(),
    imageUrl: nullableImageSchema.optional(),
    pricing: PricingSchema.optional(), // tier -> priceCents override
    totalSeats: seatCountSchema,
    shows: z.array(CreateShowSchema).max(60, 'A cinema event can have at most 60 show timings').optional(),
    seatsPerRow: z
      .number()
      .int('Seats per row must be a whole number')
      .min(1, 'Seats per row must be at least 1')
      .max(MAX_SEATS_PER_ROW, `Seats per row can be at most ${MAX_SEATS_PER_ROW}`)
      .optional(),
    vipSeats: z.number().int('VIP seats must be a whole number').min(0, 'VIP seats cannot be negative').optional(),
    premiumSeats: z
      .number()
      .int('Premium seats must be a whole number')
      .min(0, 'Premium seats cannot be negative')
      .optional(),
  })
  .superRefine((val, ctx) => {
    if ((val.vipSeats ?? 0) + (val.premiumSeats ?? 0) > val.totalSeats) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'VIP + Premium seats cannot exceed the total number of seats',
        path: ['totalSeats'],
      });
    }

    const cinema = isCinemaVenueType(val.venueType) || val.category?.toUpperCase() === 'CINEMA';
    const shows = val.shows ?? [];
    if (cinema) {
      // Legacy clients sent a single `startsAt`; accept it as the one and only show.
      if (shows.length === 0 && !val.startsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Add at least one show timing',
          path: ['shows'],
        });
      }
      const seen = new Set<number>();
      shows.forEach((s, i) => {
        const t = new Date(s.startsAt).getTime();
        if (seen.has(t)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Show timing #${i + 1} duplicates another show`,
            path: ['shows', i, 'startsAt'],
          });
        }
        seen.add(t);
      });
    } else {
      if (!val.startsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Pick a start date and time',
          path: ['startsAt'],
        });
      }
      if (shows.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Show timings are only available for cinema events',
          path: ['shows'],
        });
      }
    }
  });
export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = z
  .object({
    title: z.string().trim().min(2, 'Event title is required').max(150, 'Title must be at most 150 characters').optional(),
    description: nullableTextSchema(5000, 'Description').optional(),
    startsAt: z.string().datetime('Must be a valid ISO datetime string').optional(),
    venueName: z.string().trim().min(2, 'Venue name is required').max(150, 'Venue name must be at most 150 characters').optional(),
    location: nullableTextSchema(300, 'Location').optional(),
    imageUrl: nullableImageSchema.optional(),
    pricing: PricingSchema.optional(),
    totalSeats: seatCountSchema.optional(),
    /** `updatedAt` the editor last saw; protects against overwriting someone else's newer edit. */
    expectedUpdatedAt: z.string().datetime().optional(),
    /** Must be true to save changes that affect customers who already hold tickets. */
    confirm: z.boolean().optional(),
  })
  .strict();
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;

// Seat hold schemas
export const HoldSeatsSchema = z.object({
  seatIds: z.array(z.string().uuid('Invalid seat ID')).min(1, 'Select at least one seat').max(6, 'Maximum 6 seats per hold'),
  showId: z.string().uuid('Invalid show ID').optional(),
});
export type HoldSeatsInput = z.infer<typeof HoldSeatsSchema>;

export const ReleaseSeatsSchema = z.object({
  seatIds: z.array(z.string().uuid('Invalid seat ID')).min(1, 'Select at least one seat').max(6, 'Maximum 6 seats per release'),
  showId: z.string().uuid('Invalid show ID').optional(),
});
export type ReleaseSeatsInput = z.infer<typeof ReleaseSeatsSchema>;

// Order confirmation schema
export const ConfirmOrderSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  seatIds: z.array(z.string().uuid('Invalid seat ID')).min(1, 'Select at least one seat').max(6),
  showId: z.string().uuid('Invalid show ID').optional(),
  idempotencyKey: z.string().uuid('Invalid idempotency key').optional(),
});
export type ConfirmOrderInput = z.infer<typeof ConfirmOrderSchema>;

// Check-in schema
export const CheckInSchema = z.object({
  qrToken: z.string().min(1, 'Token or Ticket ID is required'),
});
export type CheckInInput = z.infer<typeof CheckInSchema>;
