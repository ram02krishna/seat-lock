import { Resend } from 'resend';
import { logger } from '../logger';
import { config } from '../config';

export interface SendTicketsEmailParams {
  toEmail: string;
  orderId: string;
  eventTitle: string;
  startsAt: Date;
  venueName: string;
  tickets: Array<{
    ticketId: string;
    qrToken?: string;
    seatLabel: string;
    tier: string;
    priceCents: number;
    qrDataUrl: string;
  }>;
}

const resendApiKey = config.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]!);
}

export async function sendTicketConfirmationEmail(params: SendTicketsEmailParams) {
  const { toEmail, orderId, eventTitle, startsAt, venueName, tickets } = params;

  const viewTicketsUrl =
    config.CLIENT_TICKETS_URL ||
    'https://seat-lock.vercel.app/my-tickets';

  const qrBaseUrl =
    config.QR_CODE_API_URL ||
    'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=';

  const formattedDate = new Date(startsAt).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const tierConfig: Record<string, { bg: string; text: string; border: string }> = {
    VIP: { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
    PREMIUM: { bg: '#e6f7f5', text: '#0e6a62', border: '#a7f3d0' },
    STANDARD: { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1' },
  };

  const ticketsHtml = tickets
    .map((t) => {
      const token = t.qrToken || t.ticketId;
      const tierStyle = tierConfig[t.tier.toUpperCase()] || tierConfig.STANDARD;
      const qrImageUrl = `${qrBaseUrl}${encodeURIComponent(token)}`;

      return `
        <div style="background-color: #ffffff; border: 1px solid #dfe4ec; border-radius: 12px; margin-bottom: 14px; overflow: hidden; box-shadow: 0 2px 4px rgba(16, 22, 34, 0.04);">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
            <tr>
              <td valign="top" style="padding: 16px 18px;">
                <div style="margin-bottom: 8px;">
                  <span style="background-color: ${tierStyle.bg}; color: ${tierStyle.text}; border: 1px solid ${tierStyle.border}; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.5px; display: inline-block; vertical-align: middle; margin-right: 6px;">
                    ${escapeHtml(t.tier)}
                  </span>
                  <span style="background-color: #ddf3e7; color: #168050; border: 1px solid #bbf7d0; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 3px 7px; border-radius: 4px; letter-spacing: 0.5px; display: inline-block; vertical-align: middle;">
                    ● Valid
                  </span>
                </div>
                <div style="font-size: 18px; font-weight: 800; color: #101622; margin-bottom: 4px; letter-spacing: -0.3px;">
                  ${escapeHtml(t.seatLabel)}
                </div>
                <div style="font-size: 15px; font-weight: 700; color: #168050; margin-bottom: 12px;">
                  ₹${(t.priceCents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style="background-color: #f8fafc; border: 1px solid #dfe4ec; border-radius: 6px; padding: 7px 10px; font-family: Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 11px; word-break: break-all;">
                  <span style="color: #626e82; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">Ticket Token</span>
                  <span style="color: #2554d6; font-weight: 600;">${escapeHtml(token)}</span>
                </div>
              </td>
              <td width="130" valign="middle" align="center" style="width: 130px; min-width: 130px; background-color: #fafbfc; border-left: 2px dashed #dfe4ec; padding: 14px 10px;">
                <div style="font-size: 9px; font-weight: 700; color: #626e82; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; text-align: center;">
                  Gate Scan Pass
                </div>
                <div style="background-color: #ffffff; padding: 6px; border: 1px solid #dfe4ec; border-radius: 8px; box-shadow: 0 1px 3px rgba(16, 22, 34, 0.05); display: inline-block;">
                  <img
                    src="${qrImageUrl}"
                    width="104"
                    height="104"
                    alt="Ticket QR Code"
                    style="display: block; width: 104px; height: 104px; border: 0; outline: none; border-radius: 4px;"
                  />
                </div>
                <div style="font-size: 10px; font-weight: 600; color: #168050; margin-top: 6px; text-align: center;">
                  Turnstile Ready
                </div>
              </td>
            </tr>
          </table>
        </div>
      `;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Booking Confirmed - ${escapeHtml(eventTitle)}</title>
      </head>
      <body style="margin: 0; padding: 28px 12px; background-color: #f3f5f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #101622;">
        <div style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border: 1px solid #dfe4ec; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px -2px rgba(16, 22, 34, 0.08);">
          
          <!-- Header Bar with SeatLock dark branding -->
          <div style="background-color: #0b0e14; padding: 26px 24px; border-bottom: 1px solid #1e2638;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle">
                  <!-- SeatLock SeatMark Logo Icon -->
                  <table cellpadding="0" cellspacing="0" border="0" style="display: inline-table; vertical-align: middle; margin-right: 8px;">
                    <tr>
                      <td align="center" style="padding-bottom: 2px;">
                        <div style="width: 14px; height: 5px; background-color: #2554d6; border-radius: 3px;"></div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center">
                        <div style="width: 18px; height: 6px; background-color: #2554d6; opacity: 0.6; border-radius: 3px;"></div>
                      </td>
                    </tr>
                  </table>
                  <span style="font-size: 19px; font-weight: 800; color: #ffffff; letter-spacing: -0.4px; vertical-align: middle;">
                    SeatLock
                  </span>
                </td>
                <td align="right" valign="middle">
                  <span style="background-color: rgba(22, 128, 80, 0.18); border: 1px solid rgba(22, 128, 80, 0.4); color: #4ade80; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 9999px; letter-spacing: 0.5px; display: inline-block;">
                    ● Verified Booking
                  </span>
                </td>
              </tr>
            </table>

            <div style="margin-top: 18px; text-align: left;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; line-height: 1.2;">
                Booking Confirmed!
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8; font-weight: 500;">
                Order #${orderId.slice(0, 8).toUpperCase()} &bull; Official Gate Pass Issued
              </p>
            </div>
          </div>

          <div style="padding: 24px 20px; background-color: #ffffff;">
            <!-- Event Summary Box -->
            <div style="background-color: #f8fafc; border: 1px solid #dfe4ec; border-radius: 12px; padding: 16px 18px; margin-bottom: 22px;">
              <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #101622; font-weight: 700; letter-spacing: -0.3px;">
                ${escapeHtml(eventTitle)}
              </h2>
              <div style="font-size: 13px; color: #3e495c; margin-bottom: 6px; line-height: 1.5;">
                📍 <strong style="color: #101622;">Venue:</strong> ${escapeHtml(venueName)}
              </div>
              <div style="font-size: 13px; color: #3e495c; line-height: 1.5;">
                📅 <strong style="color: #101622;">Date:</strong> ${escapeHtml(formattedDate)}
              </div>
            </div>

            <!-- Tickets Section -->
            <div style="margin-bottom: 22px;">
              <div style="margin: 0 0 12px 0; font-size: 11px; font-weight: 700; color: #626e82; text-transform: uppercase; letter-spacing: 0.8px;">
                Your Tickets (${tickets.length})
              </div>
              ${ticketsHtml}
            </div>

            <!-- Fast-Track Turnstile Entry Notice -->
            <div style="background-color: #ddf3e7; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 14px; margin-bottom: 22px; font-size: 12px; color: #166534; line-height: 1.5;">
              🎟️ <strong>Admission Notice:</strong> Present the QR code above on your mobile phone at the entrance turnstile for direct entry. No printed ticket is needed.
            </div>

            <!-- CTA Button in SeatLock Royal Blue -->
            <div style="text-align: center; margin: 24px 0 12px 0;">
              <a
                href="${escapeHtml(viewTicketsUrl)}"
                style="display: inline-block; background-color: #2554d6; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(37, 84, 214, 0.28);"
              >
                View Tickets in Web App &rarr;
              </a>
            </div>

            <!-- Footer -->
            <div style="font-size: 12px; color: #626e82; margin-top: 24px; text-align: center; line-height: 1.5; border-top: 1px solid #dfe4ec; padding-top: 18px;">
              Have questions or need to manage your booking? Access your tickets online in SeatLock.<br />
              &copy; SeatLock. Real-time Event Seating &amp; Ticketing.
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    if (!resend) {
      logger.info(`[Resend Mock] Confirmation email sent to ${toEmail} for order ${orderId}`);
      return;
    }

    const overrideEmail = config.RESEND_OVERRIDE_EMAIL;
    const recipient = overrideEmail || (toEmail.endsWith('@example.com') ? 'delivered@resend.dev' : toEmail);
    const fromEmail =
      config.RESEND_TICKETS_FROM_EMAIL ||
      config.RESEND_FROM_EMAIL ||
      'SeatLock <security@ram02krishna.me>';

    // Notice: No file attachments are passed so that email clients (e.g. Gmail) don't display
    // attachment download bars or scan notices, and the QR code renders cleanly inline via URL.
    const result = await resend.emails.send({
      from: fromEmail,
      to: recipient,
      subject: `Your Tickets for ${eventTitle} (Order #${orderId.slice(0, 8).toUpperCase()})`,
      html,
    });

    if (result.error) {
      logger.error(`Resend API Error: ${result.error.message} (code: ${result.error.name})`);
    } else {
      logger.info(`Resend ticket confirmation email sent successfully to ${recipient} (id: ${result.data?.id})`);
    }
  } catch (err) {
    logger.error(err, `Failed to send Resend email to ${toEmail}`);
  }
}

export interface SendOtpEmailParams {
  toEmail: string;
  otp: string;
  purpose: 'signup' | 'reset';
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
  isSandboxRestriction?: boolean;
}

export async function sendOtpEmail(params: SendOtpEmailParams): Promise<SendEmailResult> {
  const { toEmail, otp, purpose } = params;
  const isReset = purpose === 'reset';
  const title = isReset ? 'Reset Your Password' : 'Verify Your Email';
  const subtitle = isReset
    ? 'Use the verification code below to reset your account password.'
    : 'Use the verification code below to complete your registration.';
  const subject = isReset
    ? `Password Reset Code: ${otp}`
    : `Your Verification Code: ${otp}`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f5f8; color: #101622; margin: 0; padding: 32px 16px;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #dfe4ec; overflow: hidden; box-shadow: 0 4px 20px -2px rgba(16, 22, 34, 0.08);">
          
          <!-- Header Bar with SeatLock dark branding -->
          <div style="background-color: #0b0e14; padding: 26px 24px; border-bottom: 1px solid #1e2638;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle">
                  <!-- SeatLock SeatMark Logo Icon -->
                  <table cellpadding="0" cellspacing="0" border="0" style="display: inline-table; vertical-align: middle; margin-right: 8px;">
                    <tr>
                      <td align="center" style="padding-bottom: 2px;">
                        <div style="width: 14px; height: 5px; background-color: #2554d6; border-radius: 3px;"></div>
                      </td>
                    </tr>
                    <tr>
                      <td align="center">
                        <div style="width: 18px; height: 6px; background-color: #2554d6; opacity: 0.6; border-radius: 3px;"></div>
                      </td>
                    </tr>
                  </table>
                  <span style="font-size: 19px; font-weight: 800; color: #ffffff; letter-spacing: -0.4px; vertical-align: middle;">
                    SeatLock
                  </span>
                </td>
                <td align="right" valign="middle">
                  <span style="background-color: rgba(37, 84, 214, 0.18); border: 1px solid rgba(37, 84, 214, 0.4); color: #93c5fd; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 9999px; letter-spacing: 0.5px; display: inline-block;">
                    Security Verification
                  </span>
                </td>
              </tr>
            </table>

            <div style="margin-top: 18px; text-align: left;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
                ${title}
              </h1>
            </div>
          </div>

          <div style="padding: 28px 24px; text-align: center; background-color: #ffffff;">
            <p style="margin: 0 0 20px 0; font-size: 14px; color: #3e495c; line-height: 1.5;">
              ${subtitle}
            </p>

            <!-- OTP Code Badge in SeatLock Royal Blue -->
            <div style="margin: 16px 0 22px 0; padding: 16px 28px; background-color: #f8fafc; border: 2px dashed #2554d6; border-radius: 12px; display: inline-block;">
              <span style="font-family: Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #2554d6;">
                ${otp}
              </span>
            </div>

            <p style="margin: 0; font-size: 13px; color: #626e82;">
              This code will expire in <strong style="color: #101622;">10 minutes</strong>.
            </p>

            <div style="font-size: 12px; color: #626e82; margin-top: 26px; text-align: center; line-height: 1.5; border-top: 1px solid #dfe4ec; padding-top: 16px;">
              If you did not request this verification code, please ignore this email.<br />
              Never share this one-time code with anyone.<br />
              &copy; SeatLock. All rights reserved.
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  // OTPs are credentials; never write them to production logs. Local development can log them
  // because the API also deliberately exposes devOtp to the developer-only frontend flow.
  if (config.NODE_ENV !== 'production') {
    logger.info(`[Auth OTP] Verification code for ${toEmail} (${purpose}): ${otp}`);
  }

  if (!resend) {
    logger.info(`[Resend Mock] Resend API key not configured. Email delivery is disabled for ${toEmail}`);
    return { success: config.NODE_ENV !== 'production', error: 'Email delivery is not configured' };
  }

  try {
    const overrideEmail = config.RESEND_OVERRIDE_EMAIL;
    const recipient = overrideEmail || (toEmail.endsWith('@example.com') ? 'delivered@resend.dev' : toEmail);
    const fromEmail = config.RESEND_FROM_EMAIL || 'SeatLock <security@ram02krishna.me>';

    const result = await resend.emails.send({
      from: fromEmail,
      to: recipient,
      subject,
      html,
    });

    if (result.error) {
      const isSandboxRestriction =
        result.error.name === 'validation_error' &&
        result.error.message.includes('You can only send testing emails to your own email address');

      logger.error(`Resend OTP Error: ${result.error.message} (code: ${result.error.name})`);
      if (isSandboxRestriction) {
        logger.warn(
          `[Resend Notice] Resend sandbox restriction: Test accounts can only send emails to the registered Resend account owner. To send to any recipient, verify your domain at resend.com/domains and set RESEND_FROM_EMAIL.`
        );
      }
      return {
        success: false,
        error: result.error.message,
        isSandboxRestriction,
      };
    }

    logger.info(`Resend OTP email sent successfully to ${recipient} (id: ${result.data?.id})`);
    return { success: true };
  } catch (err: any) {
    logger.error(err, `Failed to send Resend OTP email to ${toEmail}`);
    return { success: false, error: err?.message || 'Failed to send verification email' };
  }
}

export interface SendEventUpdatedEmailParams {
  toEmail: string;
  eventTitle: string;
  startsAt: Date;
  venueName: string;
  location?: string | null;
  changes: string[];
}

/** Tells ticket holders that the date or place of an event they booked has changed. */
export async function sendEventUpdatedEmail(params: SendEventUpdatedEmailParams) {
  const { toEmail, eventTitle, startsAt, venueName, location, changes } = params;
  const viewTicketsUrl = config.CLIENT_TICKETS_URL || 'https://seat-lock.vercel.app/my-tickets';
  const formattedDate = new Date(startsAt).toLocaleString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const html = `
    <!DOCTYPE html>
    <html>
      <body style="font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f3f5f8; color: #101622; margin: 0; padding: 32px 16px;">
        <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #dfe4ec; padding: 28px 24px;">
          <h1 style="margin: 0 0 6px 0; font-size: 20px;">Event details updated</h1>
          <p style="margin: 0 0 18px 0; font-size: 14px; color: #3e495c;">
            The organizer changed details of <strong>${escapeHtml(eventTitle)}</strong>. Your tickets and seats are unchanged and remain valid.
          </p>
          <ul style="margin: 0 0 18px 18px; padding: 0; font-size: 14px; color: #101622;">
            ${changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}
          </ul>
          <div style="background: #f8fafc; border: 1px solid #dfe4ec; border-radius: 12px; padding: 14px 16px; font-size: 14px;">
            <div><strong>When:</strong> ${escapeHtml(formattedDate)}</div>
            <div><strong>Venue:</strong> ${escapeHtml(venueName)}</div>
            ${location ? `<div><strong>Location:</strong> ${escapeHtml(location)}</div>` : ''}
          </div>
          <p style="margin: 20px 0 0 0;">
            <a href="${escapeHtml(viewTicketsUrl)}" style="display: inline-block; background: #2554d6; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 8px;">View my tickets</a>
          </p>
        </div>
      </body>
    </html>
  `;

  try {
    if (!resend) {
      logger.info(`[Resend Mock] Event update email sent to ${toEmail} for "${eventTitle}"`);
      return;
    }
    const overrideEmail = config.RESEND_OVERRIDE_EMAIL;
    const recipient = overrideEmail || (toEmail.endsWith('@example.com') ? 'delivered@resend.dev' : toEmail);
    const fromEmail =
      config.RESEND_TICKETS_FROM_EMAIL || config.RESEND_FROM_EMAIL || 'SeatLock <security@ram02krishna.me>';
    const result = await resend.emails.send({
      from: fromEmail,
      to: recipient,
      subject: `Update: ${eventTitle} has changed`,
      html,
    });
    if (result.error) {
      logger.error(`Resend API Error: ${result.error.message} (code: ${result.error.name})`);
    }
  } catch (err) {
    logger.error(err, `Failed to send event update email to ${toEmail}`);
  }
}
