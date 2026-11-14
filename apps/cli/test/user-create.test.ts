import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { openTestDb, resetTestDb, testDbAvailable } from '@radar/db/testing';
import { schema } from '@radar/db';
import { eq } from 'drizzle-orm';

const available = await testDbAvailable();
const url = process.env.TEST_DATABASE_URL ?? 'postgres://radar:radar@localhost:5432/radar_test';

function radar(...args: string[]) {
  const res = spawnSync(process.execPath, ['--import', 'tsx', 'apps/cli/src/index.ts', ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
      BETTER_AUTH_URL: 'http://localhost:8787',
      WEB_ORIGIN: 'http://localhost:3000',
    },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

describe('radar user:create', () => {
  it('is in the usage text', () => {
    expect(radar('--help').out).toContain('user:create --email <e> --password <p> [--name <n>]');
  });

  it('needs an email and a password', () => {
    const res = radar('user:create', '--email', 'a@example.com');
    expect(res.code).toBe(1);
    expect(res.out).toContain('usage: radar user:create');
  });

  it.skipIf(!available)('creates a verified user once and refuses the same email', async () => {
    const db = await openTestDb();
    try {
      await resetTestDb(db);
      const first = radar(
        'user:create',
        '--email',
        'Review@Example.com',
        '--password',
        'correct-horse-battery',
        '--name',
        'Reviewer',
      );
      expect(first.out).toContain('created review@example.com');
      expect(first.code ?? 0).toBe(0);

      const [u] = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, 'review@example.com'));
      expect(u).toMatchObject({ name: 'Reviewer', emailVerified: true });
      const accounts = await db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, u!.id));
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({ providerId: 'credential' });
      expect(accounts[0]!.password).toBeTruthy();
      expect(accounts[0]!.password).not.toContain('correct-horse');

      const again = radar(
        'user:create',
        '--email',
        'review@example.com',
        '--password',
        'correct-horse-battery',
      );
      expect(again.code).toBe(1);
      expect(again.out).toContain('already exists');
    } finally {
      await db.$client.end({ timeout: 1 });
    }
  });
});
