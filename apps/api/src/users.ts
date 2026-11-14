import type { Db } from '@radar/db';
import { createAuth } from './auth.js';
import type { ApiEnv } from './env.js';

export interface NewPasswordUser {
  email: string;
  password: string;
  name?: string;
}

/**
 * Creates a verified email + password user straight in the database, using Better Auth's own
 * password hashing and user hooks (so the new user gets the same default config and trial as
 * anyone who signs up). It works however sign-up is set on the web, which is the point: production
 * keeps public sign-up closed beside Google, and a reviewer's test account is made here instead.
 * Refuses when the email is already taken.
 */
export async function createPasswordUser(
  db: Db,
  env: ApiEnv,
  input: NewPasswordUser,
): Promise<{ id: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('that does not look like an email address');

  const ctx = await createAuth(db, env).$context;
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (input.password.length < minPasswordLength) {
    throw new Error(`the password must be at least ${minPasswordLength} characters`);
  }
  if (input.password.length > maxPasswordLength) {
    throw new Error(`the password must be at most ${maxPasswordLength} characters`);
  }
  if (await ctx.internalAdapter.findUserByEmail(email)) {
    throw new Error(`a user with ${email} already exists`);
  }

  const hash = await ctx.password.hash(input.password);
  const user = await ctx.internalAdapter.createUser(
    {
      email,
      name: input.name?.trim() || email.split('@')[0] || email,
      emailVerified: true,
    },
    { method: 'admin' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  });
  return { id: user.id, email: user.email };
}
