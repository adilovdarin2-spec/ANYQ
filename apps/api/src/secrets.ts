/**
 * The one place a secret is read, and the one place a missing one is refused.
 *
 * Both auth modules previously fell back to a fixed string committed in this
 * repository. Deployed without JWT_SECRET set, every token would be signed
 * with a value any reader of the source can produce — which is not a weak
 * secret but no secret at all: anyone could mint a token for any company.
 *
 * Failing to start is the correct response. A server that boots and quietly
 * accepts forged tokens is worse in every way than one that does not boot,
 * because the first is discovered by an attacker and the second by a deploy.
 */
const DEVELOPMENT_FALLBACKS: Record<string, string> = {
  JWT_SECRET: 'anyq-local-development-only',
};

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function requireSecret(name: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value;

  // Outside production a fallback keeps a developer from having to set up
  // secrets before they can run anything — but it is a different string from
  // anything a deployment would use, so it can never be mistaken for one.
  if (!isProduction()) {
    const fallback = DEVELOPMENT_FALLBACKS[name];
    if (fallback) {
      console.warn(`[secrets] ${name} is not set — using the development fallback. Never do this in production.`);
      return fallback;
    }
  }

  throw new Error(`${name} is not set. The server will not start without it: ${WHY[name] ?? GENERIC_WHY}`);
}

/**
 * Why each secret matters, in the words of what goes wrong without it.
 *
 * One message for all of them said tokens could be forged, which is true of
 * JWT_SECRET and nonsense for a push key. An operator reading a start-up failure
 * at seven in the morning should be told what this particular value is for, not
 * a sentence about a different one.
 */
const WHY: Record<string, string> = {
  JWT_SECRET:
    'tokens signed with a default secret can be minted by anyone who can read the source, for any company.',
  VAPID_PRIVATE_KEY:
    'a push key committed to the repository lets anyone sign a notification that an owner\'s browser will accept — ' +
    'an order that never happened, arriving from you. Generate a pair with `npx web-push generate-vapid-keys`.',
  VAPID_PUBLIC_KEY:
    'it is the other half of VAPID_PRIVATE_KEY and browsers check the pair matches. ' +
    'Generate both with `npx web-push generate-vapid-keys`.',
};

const GENERIC_WHY = 'a value committed to the source is known to everyone who can read it, which makes it no secret at all.';
