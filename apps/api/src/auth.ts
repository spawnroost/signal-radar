import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { schema, type Db } from '@radar/db';
import type { ApiEnv } from './env.js';
import radarConfig from '../../../radar.config.js';

export const TRIAL_DAYS = 7;

/** Which sign-in methods this server offers. */
export interface AuthMethods {
  google: boolean;
  github: boolean;
  /** Email + password works (the server accepts it). */
  email: boolean;
  /** Email + password is the only way in, so the UI shows it as the main form, not a dev extra. */
  emailPrimary: boolean;
}

/**
 * A social provider is on only when both of its keys are set. Email + password is on only while
 * no provider is configured; once one is, it is off, except in dev and test (NODE_ENV not
 * production) where it stays for the demo account and the tests.
 */
export function authMethods(env: ApiEnv): AuthMethods {
  const google = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const github = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  const emailPrimary = !google && !github;
  return { google, github, email: emailPrimary || env.NODE_ENV !== 'production', emailPrimary };
}

export function createAuth(db: Db, env: ApiEnv) {
  const methods = authMethods(env);
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Dev only: allow Cloudflare quick tunnels (vite allows them too) for testing on a phone.
    trustedOrigins:
      env.NODE_ENV === 'production'
        ? [env.WEB_ORIGIN]
        : [env.WEB_ORIGIN, 'https://*.trycloudflare.com'],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: methods.email },
    // Google and GitHub sign-in are each on only when both of their keys are set. A login with
    // the same verified email as an existing account joins that account instead of making a second.
    socialProviders: {
      ...(methods.google && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {}),
      ...(methods.github && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
        : {}),
    },
    account: { accountLinking: { enabled: true, trustedProviders: ['google', 'github'] } },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Every new user gets the default niches (so the pipeline has something to score
            // before they open Settings) and a 7-day Pro trial.
            const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
            await db
              .insert(schema.userConfig)
              .values({ userId: user.id, niches: radarConfig.niches })
              .onConflictDoNothing();
            await db
              .insert(schema.subscription)
              .values({
                userId: user.id,
                plan: 'pro',
                status: 'trialing',
                trialEndsAt,
                provider: 'stub',
              })
              .onConflictDoNothing();
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
