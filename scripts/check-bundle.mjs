#!/usr/bin/env node
/**
 * Reads the built front ends and refuses the ones that would not work.
 *
 * Vite bakes `import.meta.env.VITE_*` into the bundle at build time. Get it
 * wrong and nothing complains: the build succeeds, the files look right, and the
 * shop discovers it when a cashier taps "Войти" and the till tries to reach a
 * machine in another country. There are three ways to get it wrong and all three
 * are silent:
 *
 *   1. The variable is not set on the build, so the fallback ships. Every app
 *      falls back to `http://localhost:4000` for the API, which for a customer's
 *      browser means their own laptop.
 *   2. A stray `.env.local` on the machine doing the build. This is not
 *      hypothetical — it is how this check came to be written: the POS bundle in
 *      this repository was pointing at `localhost:4010`, from a gitignored file
 *      left over from a debugging session.
 *   3. A cross-app link falls back to a hostname from an older deployment. That
 *      one is the worst of the three, because it is a live URL: the owner copies
 *      their storefront link, hands it to their suppliers, and it goes to
 *      somebody else's server.
 *
 * So this checks the artifact rather than the intent. Run after building for a
 * deployment; `npm run build:deploy` does both.
 *
 *   node scripts/check-bundle.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APPS = ['pos', 'admin', 'orders'];

/**
 * Things that must not survive into a deployed bundle, and what to do about it.
 *
 * Matched against the built JavaScript as text. Crude on purpose: the question
 * is "does this string appear in what we are about to serve", and no amount of
 * parsing answers it better than looking.
 */
const FORBIDDEN = [
  {
    pattern: /localhost:\d+/g,
    say: (found) =>
      `points at ${found} — a customer's browser would try to reach their own machine.\n` +
      "      Set VITE_API_URL on the build. If you did, check for a stray .env.local in the app directory:\n" +
      '      Vite reads it and it beats the environment.',
  },
  {
    pattern: /127\.0\.0\.1:\d+/g,
    say: (found) => `points at ${found}, which is the same problem as localhost. Set VITE_API_URL.`,
  },
  {
    // The specific hostnames this repository once fell back to. Named rather
    // than matched by a pattern, because "any railway.app URL" is legitimate —
    // it is where this is deployed.
    pattern: /orders-production-f493\.up\.railway\.app|pos-production-2e42\.up\.railway\.app/g,
    say: (found) =>
      `carries ${found}, a hostname from an older deployment.\n` +
      '      A wrong link is worse than none: the owner copies their storefront address and hands\n' +
      '      partners a link to somebody else\'s server. Set VITE_ORDERS_URL and VITE_POS_URL.',
  },
];

let problems = 0;
let checked = 0;

for (const app of APPS) {
  const assets = join('apps', app, 'dist', 'assets');
  if (!existsSync(assets)) {
    console.log(`  ..   apps/${app} has no dist/assets — not built, skipping`);
    continue;
  }

  const scripts = readdirSync(assets).filter((f) => f.endsWith('.js'));
  if (scripts.length === 0) {
    // Said rather than passed over: an assets directory with no JavaScript in it
    // means the build did not produce what this is meant to be checking.
    console.log(`  FAIL apps/${app}: dist/assets holds no .js — nothing was checked`);
    problems++;
    continue;
  }

  checked++;
  const source = scripts.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

  let clean = true;
  for (const rule of FORBIDDEN) {
    const hits = [...new Set(source.match(rule.pattern) ?? [])];
    if (hits.length === 0) continue;
    clean = false;
    problems++;
    console.log(`  FAIL apps/${app} ${rule.say(hits.join(', '))}`);
  }
  if (clean) console.log(`  OK   apps/${app}`);
}

console.log('');
if (checked === 0) {
  console.error('Nothing was checked: no app has a dist/assets directory. Build first.');
  process.exitCode = 2;
} else if (problems > 0) {
  console.error(`${problems} problem(s) in ${checked} bundle(s). These would deploy and fail quietly.`);
  process.exitCode = 1;
} else {
  console.log(`${checked} bundle(s) carry no local or stale addresses.`);
}
