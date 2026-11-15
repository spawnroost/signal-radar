import { z } from 'zod';
import { isValidUpiId } from '@radar/core';

export const ApiEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Receiving UPI ID (name@bank). Unset = UPI payments closed. */
  UPI_VPA: z.string().trim().refine(isValidUpiId, 'UPI_VPA must look like name@bank').optional(),
  UPI_PAYEE_NAME: z.string().trim().min(1).default('Signal Radar'),
  /** Comma-separated admin emails, compared trimmed and case-insensitively. */
  ADMIN_EMAILS: z.string().optional(),
  /** Optional override for the admin Telegram chat; default is the admins' linked chats. */
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  NODE_ENV: z.string().optional(),
});
export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** Validates process.env-like input; empty strings count as unset. */
export function parseEnv(raw: Record<string, string | undefined>): ApiEnv {
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''),
  );
  return ApiEnvSchema.parse(cleaned);
}

/** Is this email listed in ADMIN_EMAILS? Trimmed, case-insensitive; empty list means nobody. */
export function isAdminEmail(
  env: Pick<ApiEnv, 'ADMIN_EMAILS'>,
  email: string | null | undefined,
): boolean {
  const e = email?.trim().toLowerCase();
  if (!e || !env.ADMIN_EMAILS) return false;
  return env.ADMIN_EMAILS.split(',').some((a) => a.trim().toLowerCase() === e);
}
