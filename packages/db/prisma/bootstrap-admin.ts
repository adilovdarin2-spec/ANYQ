/**
 * Creates the one platform account that can open the admin panel.
 *
 * Until now this only existed as a side effect of `prisma db seed`, and that
 * seed also creates demo companies — a café, a pharmacy, invented sales. So
 * connecting a real customer meant choosing between a database with fake shops
 * in it and no way to log in at all. Neither is a choice anybody should be asked
 * to make on the morning of a launch.
 *
 * This creates exactly one row and touches nothing else.
 *
 *   ADMIN_EMAIL=owner@example.kz ADMIN_PASSWORD='...' npm run admin:create --workspace=packages/db
 *
 * Re-running it against an address that already exists does nothing unless
 * `--reset-password` is passed. An operator running the command twice during a
 * fraught setup should not silently lock out whoever is already using it.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Short enough to type on a phone, long enough to be worth the bcrypt.
 *
 * Twelve rather than eight: this single account can read and change every
 * company on the platform, and it is reachable from the open internet. The
 * login is rate-limited and can carry a second factor, but neither of those
 * helps against a password somebody guesses first time.
 */
const MIN_PASSWORD = 12;

/** Passwords that exist in this repository, in examples, or in everyone's list. */
const REFUSED = new Set([
  'anyq2026',
  'anyq2026!',
  'password',
  'password123',
  'admin',
  'admin123',
  'qwerty123456',
  '123456789012',
  'changeme',
  'changeme123',
]);

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function main(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const name = (process.env.ADMIN_NAME ?? '').trim() || 'Администратор платформы';
  const resetPassword = process.argv.includes('--reset-password');

  if (!email || !email.includes('@')) {
    fail('ADMIN_EMAIL is not set, or is not an address. Nothing was created.');
  }
  if (password.length < MIN_PASSWORD) {
    fail(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters. This account can read and ` +
        'change every company on the platform. Nothing was created.',
    );
  }
  if (REFUSED.has(password.toLowerCase())) {
    // Including the one this project used to seed by default. It is in the git
    // history of a public-shaped repository, which makes it a username.
    fail('ADMIN_PASSWORD is one this project has shipped or that appears in every word list. Nothing was created.');
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (existing && !resetPassword) {
    // Said plainly rather than treated as an error: during a setup somebody will
    // run this twice, and the honest answer is "it is already there".
    console.log(`${email} already exists. Left alone. Pass --reset-password to set a new password for it.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  if (existing) {
    await prisma.adminUser.update({
      where: { email },
      // The password only. Name, second factor and recovery codes are the
      // account holder's, and a password reset is not a reason to drop them.
      data: { passwordHash },
    });
    console.log(`Password changed for ${email}.`);
    return;
  }

  await prisma.adminUser.create({ data: { email, name, passwordHash } });
  console.log(`Created ${email}. Turn on the second factor from the panel before a customer's data is in here.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
