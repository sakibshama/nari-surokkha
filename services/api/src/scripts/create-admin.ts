/**
 * Usage (on the server):
 *   docker compose -f docker-compose.prod.yml --env-file .env.production \
 *     run --rm api node dist/scripts/create-admin.js
 *
 * Prompts for phone, name, optional email and password (hidden). For
 * non-interactive use set ADMIN_PHONE, ADMIN_NAME, ADMIN_EMAIL and
 * ADMIN_PASSWORD in the environment instead. Running it again for the same
 * phone promotes that account and resets its password.
 */
import readline from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { createOrPromoteAdmin, validateAdminInput } from './admin-bootstrap';

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Echo nothing while the password is typed.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const fromEnv = Boolean(process.env.ADMIN_PHONE && process.env.ADMIN_PASSWORD);
  if (!fromEnv && !process.stdin.isTTY) {
    throw new Error('No terminal: run with `-it` (docker compose run gives one) or set ADMIN_PHONE / ADMIN_NAME / ADMIN_PASSWORD.');
  }

  const phone = process.env.ADMIN_PHONE ?? (await ask('Admin phone (e.g. +8801712345678): '));
  const fullName = process.env.ADMIN_NAME ?? (await ask('Full name: '));
  const email = process.env.ADMIN_EMAIL ?? (fromEnv ? '' : await ask('Email (optional): '));
  let password = process.env.ADMIN_PASSWORD ?? '';
  if (!fromEnv) {
    password = await ask('Password (min 12 characters): ', true);
    const again = await ask('Repeat password: ', true);
    if (password !== again) throw new Error('Passwords do not match.');
  }

  const input = { phone, fullName, password, email: email || undefined };
  const problem = validateAdminInput(input);
  if (problem) throw new Error(problem);

  const prisma = new PrismaClient();
  try {
    const result = await createOrPromoteAdmin(prisma, input);
    console.warn(
      result.action === 'created'
        ? `✅ Administrator created. Sign in to the admin portal with ${phone}.`
        : `✅ Existing account ${phone} is now an administrator (password reset, old sessions signed out).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
