import type { FiscalPayload, FiscalProvider, FiscalRegistration } from './fiscal';

/**
 * The network adapter: one HTTP call, and nothing else.
 *
 * Deliberately the thinnest thing in the fiscal path. The worker owns when to
 * try, how long to wait and when to give up; all this owes is "send this
 * payload, return the number or throw". That split is why the worker could be
 * written and tested before the provider's live documentation arrived, and why
 * writing the real call will not change anything around it.
 *
 * It is not finished, and says so rather than pretending. What is missing is
 * the provider's actual request shape, which needs their current documentation
 * and a test register to try it against — neither of which can be guessed at,
 * and both of which would be wrong if they were. Until the endpoint is
 * configured this refuses to send, and `ready()` says so up front, so the
 * worker never queues a pass against a URL that does not exist.
 */

export const FISCAL_ENDPOINT_ENV = 'FISCAL_API_URL';
export const FISCAL_TOKEN_ENV = 'FISCAL_API_TOKEN';

/** Raised when fiscalisation over the network is not configured on this deployment. */
export class FiscalNotConfiguredError extends Error {
  /**
   * 501, which the classifier reads as transient — correctly, in the general
   * case: a 5xx is the server having a bad day. It is the wrong reading here,
   * and the reason the worker asks `ready()` before it calls this at all. Left
   * alone rather than forced to a 4xx, because a 4xx would mean "the OFD
   * rejected this receipt", which is a different and much worse lie.
   */
  status = 501;
  constructor() {
    super('Сетевая фискализация не настроена на этом сервере');
  }
}

/** Both halves of the configuration, or neither is any use. */
export function fiscalNetworkConfigured(): boolean {
  return Boolean(process.env[FISCAL_ENDPOINT_ENV] && process.env[FISCAL_TOKEN_ENV]);
}

export function networkFiscalProvider(name = 'webkassa'): FiscalProvider {
  return {
    name,
    // Read per call rather than captured: a deployment can gain its credentials
    // while the process is running, and a provider built at boot should notice.
    ready: fiscalNetworkConfigured,
    async register(payload: FiscalPayload): Promise<FiscalRegistration> {
      const endpoint = process.env[FISCAL_ENDPOINT_ENV];
      const token = process.env[FISCAL_TOKEN_ENV];
      if (!endpoint || !token) throw new FiscalNotConfiguredError();

      // The shape below is the one the worker guarantees; the provider's own
      // field names go here, and only here, once their documentation is in hand.
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          // The sale id, so the provider treats a retry as the same receipt
          // rather than filing a second one. Without it the whole retry policy
          // above becomes a way of fiscalising one sale eight times.
          'Idempotency-Key': payload.documentId,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // Thrown with the status attached, which is what the worker's classifier
        // reads to tell a dropped connection from a rejected receipt.
        throw Object.assign(new Error(`ОФД ответил ${response.status}: ${detail.slice(0, 200)}`), {
          status: response.status,
        });
      }

      const data = (await response.json()) as { fiscalNumber?: unknown; fiscalSign?: unknown; registeredAt?: unknown };
      if (typeof data.fiscalNumber !== 'string' || typeof data.fiscalSign !== 'string') {
        // A 200 with nothing usable in it is worse than an error: recording it
        // as registered would say a receipt reached the tax authority when
        // nobody knows that it did.
        throw Object.assign(new Error('ОФД ответил без номера чека'), { status: 502 });
      }

      const registeredAt = typeof data.registeredAt === 'string' ? new Date(data.registeredAt) : new Date();
      return {
        fiscalNumber: data.fiscalNumber,
        fiscalSign: data.fiscalSign,
        registeredAt: Number.isNaN(registeredAt.getTime()) ? new Date() : registeredAt,
      };
    },
  };
}
