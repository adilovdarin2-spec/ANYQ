import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
 */

const TENANT_FACING = ['apps/api/src/routes/pos.ts', 'apps/api/src/routes/supply.ts'];

const REPO_ROOT = resolve(__dirname, '../../..');

/** Tokens that mean "this query is confined to one tenant". */
const SCOPE = /companyId|posCompanyId|locationId|adminUserId/;

const READ_OR_WRITE = /prisma\.(\w+)\.(findFirst|findUnique|findUniqueOrThrow|update|updateMany|delete|deleteMany|count|aggregate|groupBy)/;

/** Something the caller chose, as opposed to something the server derived. */
const CALLER_SUPPLIED = /req\.params|req\.body|req\.query/;

/**
 * Calls that are scoped by code rather than by the query.
 *
 * Each entry is the exact call and the check that makes it safe. The check is
 * verified to still exist within a few lines — an allowlist that only excuses a
 * line would quietly keep excusing it after somebody deleted the check.
 */
const SCOPED_IN_CODE: { call: string; followedBy: RegExp; why: string }[] = [
  {
    call: 'const bin = await prisma.storageBin.findUnique({ where: { id: req.params.id } });',
    followedBy: /locationIds\.has\(bin\.locationId\)/,
    why:
      'The bin/block and bin/unblock routes load the shelf, then 404 unless its ' +
      'location is one of the calling company\'s own. A bin has no companyId of ' +
      'its own — it belongs to a location — so the check cannot live in the where.',
  },
];

interface Call {
  file: string;
  line: number;
  model: string;
  text: string;
  /** The few lines after it, where a code-level check would live. */
  following: string;
}

function callsKeyedOnInput(): Call[] {
  const found: Call[] = [];
  for (const file of TENANT_FACING) {
    const lines = readFileSync(resolve(REPO_ROOT, file), 'utf8').split('\n');
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
      });
    });
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
      return !exemption.followedBy.test(call.following);
    });

    expect(
      unscoped.map((call) => `${call.file}:${call.line} (${call.model}) ${call.text.trim().slice(0, 90)}`),
    ).toEqual([]);
  });

  it('does not keep an exemption for a call that has gone', () => {
    // The other direction, same reason as everywhere else: a stale exemption
    // eventually excuses something it was never meant to.
    const all = callsKeyedOnInput().map((call) => call.text).join('\n');
    const stale = SCOPED_IN_CODE.filter((entry) => !all.includes(entry.call)).map((entry) => entry.call);
    expect(stale).toEqual([]);
  });
});
