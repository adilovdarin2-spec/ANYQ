import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * The contract's strongest sentence, made checkable.
 *
 * PRODUCT_READINESS: «Никакой запрос по `id` не может обходить `companyId`; это
 * требование относится и к файлам, печати, webhooks и экспортам.» It is the
 * sentence a multi-tenant product lives or dies by, and it held when somebody
 * went and looked — but it had not always held: the readiness audit records a
 * hole in `/pos/sales` and `/pos/shifts`, found by reading and fixed.
 *
 * Reading finds a hole once. This finds the next one. Every Prisma call in the
 * tenant-facing routes that is keyed off something the caller supplied must
 * either name a tenant scope in the query, or be one of the handful that loads
 * first and checks membership immediately after — and for those, the check
 * itself is asserted to still be there, rather than the line merely excused.
 *
 * Deliberately not covered: `routes/companies.ts` and `routes/auth.ts`. Those
 * serve the platform admin, who sits outside the tenant boundary by design —
 * looking up any company by id is their whole job. Widening this to them would
 * mean asserting the opposite of what they are for.
 *
 * `routes/cabinet.ts` was outside this list until 15.09.2026 for a reason that
 * stopped being true: it only read, and read one company's own summary. Then it
 * gained a write — согласие владельца на доступ поддержки, — and a write keyed
 * on `req.params.id`. That id is supplied by the caller like any other, and the
 * cabinet is the thinnest credential in the product: a secret link and a
 * password. It belongs here.
 */

const TENANT_FACING = [
  'apps/api/src/routes/pos.ts',
  'apps/api/src/routes/supply.ts',
  'apps/api/src/routes/cabinet.ts',
];

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Tokens that mean "this query is confined to one tenant".
 *
 * `locationId` belongs here only because of the second test below. A location id
 * that arrived from the caller is not a scope on its own — taking
 * `req.query.locationId` straight into a `where` is one shop reading another's
 * stock. It counts as a scope because every handler that accepts one runs it
 * through `resolveLocationOrRespond` first, which answers 404 unless the id is
 * one of the calling company's own. If that ever stops being true, the test
 * that checks it fails and this list stops being honest.
 */
const SCOPE = /companyId|posCompanyId|locationId|adminUserId/;

/** Ways a handler can establish that a caller's location is really theirs. */
const LOCATION_VERIFIED = /resolveLocationOrRespond|resolveLocationId|locationIds\.has|locations\.find|locations\.some/;

/** A location id the caller chose, rather than one the server derived. */
const LOCATION_FROM_CALLER = /req\.query\.locationId|req\.body\.locationId|req\.params\.locationId|(?<![\w.])b\.locationId/;

const READ_OR_WRITE = /prisma\.(\w+)\.(findFirst|findUnique|findUniqueOrThrow|update|updateMany|delete|deleteMany|count|aggregate|groupBy)/;

/** Something the caller chose, as opposed to something the server derived. */
const CALLER_SUPPLIED = /req\.params|req\.body|req\.query/;

/**
 * Calls that are scoped by code rather than by the query.
 *
 * Each entry is the exact call and the check that makes it safe. The check is
 * verified to still exist within a few lines — an allowlist that only excuses a
 * line would quietly keep excusing it after somebody deleted the check.
 *
 * The check may sit on either side of the call. `followedBy` is the usual
 * shape: load it, then refuse unless it is ours. `precededBy` is the cabinet's:
 * the row is found by the secret that *is* the tenant credential, and only then
 * updated by its own id. Both are real safety; excusing a line without naming
 * which of the two it relies on is what this list exists to prevent.
 */
const SCOPED_IN_CODE: { call: string; followedBy?: RegExp; precededBy?: RegExp; why: string }[] = [
  {
    call: 'const bin = await prisma.storageBin.findUnique({ where: { id: req.params.id } });',
    followedBy: /locationIds\.has\(bin\.locationId\)/,
    why:
      'The bin/block and bin/unblock routes load the shelf, then 404 unless its ' +
      'location is one of the calling company\'s own. A bin has no companyId of ' +
      'its own — it belongs to a location — so the check cannot live in the where.',
  },
  {
    call: 'const updated = await prisma.ownerCabinet.update({',
    precededBy: /findBySecret\(req\.params\.secret\)/,
    why:
      'The cabinet is found by its secret, and that secret is the tenant ' +
      'credential: there is no path to a row whose link you do not already ' +
      'hold. The update then names that row by its own id, which is why no ' +
      'companyId appears in the where. The check here is the lookup itself, ' +
      'and it sits before the call rather than after it.',
  },
];

interface Call {
  file: string;
  line: number;
  model: string;
  text: string;
  /** The few lines after it, where a code-level check would live. */
  following: string;
  /** And the few before it, for the checks that guard the lookup instead. */
  preceding: string;
}

function callsKeyedOnInput(): Call[] {
  const found: Call[] = [];
  for (const file of TENANT_FACING) {
    const lines = withoutComments(readFileSync(resolve(REPO_ROOT, file), 'utf8')).split('\n');
    lines.forEach((line, index) => {
      const match = READ_OR_WRITE.exec(line);
      if (!match) return;

      // The call can span lines; gather to its closing paren.
      let text = '';
      for (let j = index; j < Math.min(index + 16, lines.length); j++) {
        text += lines[j] + '\n';
        if (/\}\)\s*;?\s*$/.test(lines[j])) break;
      }
      if (!CALLER_SUPPLIED.test(text)) return;

      found.push({
        file,
        line: index + 1,
        model: match[1],
        text,
        following: lines.slice(index, index + 6).join('\n'),
        // Двадцать строк — это не «чем больше, тем лучше», а расстояние от
        // поиска по секрету до записи в `/:secret/password`: между ними стоят
        // два отказа со своими сообщениями. Окно смотрит только внутрь записи
        // из списка исключений — сама запись находится по точному тексту
        // вызова, — так что ширина не ослабляет проверку остальных.
        preceding: lines.slice(Math.max(0, index - 20), index).join('\n'),
      });
    });
  }
  return found;
}

/** Every route handler that accepts a location id chosen by the caller. */
function handlersTakingACallerLocation(): { file: string; header: string; body: string }[] {
  const found: { file: string; header: string; body: string }[] = [];
  for (const file of TENANT_FACING) {
    const src = withoutComments(readFileSync(resolve(REPO_ROOT, file), 'utf8'));
    // Every handler starts at `xRouter.method(` in column one.
    for (const body of src.split(/\n(?=\w+Router\.(?:get|post|put|patch|delete)\()/)) {
      const header = body.split('\n')[0].trim().slice(0, 80);
      if (!/Router\.(get|post|put|patch|delete)\(/.test(header)) continue;
      if (!LOCATION_FROM_CALLER.test(body)) continue;
      found.push({ file, header, body });
    }
  }
  return found;
}

describe('tenant isolation', () => {
  it('finds the calls it is supposed to be checking', () => {
    // A guard on the guard. If the extractor stops matching — a Prisma upgrade,
    // a reformat — it would pass by finding nothing, which is the failure mode
    // that makes source-reading tests worthless.
    const calls = callsKeyedOnInput();
    expect(calls.length).toBeGreaterThan(25);
  });

  it('scopes every by-id query to one company', () => {
    const unscoped = callsKeyedOnInput().filter((call) => {
      if (SCOPE.test(call.text)) return false;
      const exemption = SCOPED_IN_CODE.find((entry) => call.text.includes(entry.call));
      if (!exemption) return true;
      // The exemption is only good while the check it points at is still there.
      if (exemption.followedBy) return !exemption.followedBy.test(call.following);
      if (exemption.precededBy) return !exemption.precededBy.test(call.preceding);
      // An entry naming neither check excuses nothing. That is the list rotting
      // into a rubber stamp, and it should fail loudly rather than pass quietly.
      return true;
    });

    expect(
      unscoped.map((call) => `${call.file}:${call.line} (${call.model}) ${call.text.trim().slice(0, 90)}`),
    ).toEqual([]);
  });

  it('checks a location the caller asked for before trusting it', () => {
    // The hole this closes does not look like a hole: `where: { locationId }`
    // reads as properly scoped, and is the opposite if the id came from the
    // request unchecked. One shop would read another's stock, and the query
    // would pass review.
    const unverified = handlersTakingACallerLocation()
      .filter(({ body }) => !LOCATION_VERIFIED.test(body))
      .map(({ file, header }) => `${file} ${header}`);
    expect(unverified).toEqual([]);
  });

  it('finds the handlers it is supposed to be checking', () => {
    // Same guard-on-the-guard as above: the location test would pass by matching
    // nothing if the helper were renamed or the handlers reshaped.
    expect(handlersTakingACallerLocation().length).toBeGreaterThan(20);
  });

  it('does not keep an exemption for a call that has gone', () => {
    // The other direction, same reason as everywhere else: a stale exemption
    // eventually excuses something it was never meant to.
    const all = callsKeyedOnInput().map((call) => call.text).join('\n');
    const stale = SCOPED_IN_CODE.filter((entry) => !all.includes(entry.call)).map((entry) => entry.call);
    expect(stale).toEqual([]);
  });
});
