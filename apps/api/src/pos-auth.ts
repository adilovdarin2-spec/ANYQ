import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@anyq/db';
import { shouldTouchLastSeen } from './devices';
import { requireSecret } from './secrets';

const JWT_SECRET = requireSecret('JWT_SECRET');

export interface PosAuthedRequest extends Request {
  posUserId?: string;
  posCompanyId?: string;
  /** The register this request came from, when it told us. */
  posDeviceId?: string;
}

interface PosTokenPayload {
  type: 'pos';
  sub: string;
  companyId: string;
  /** The account's token version when this was minted. See User.tokenVersion. */
  v?: number;
  /** The PosDevice row this was handed to. Absent on tokens minted before
   *  devices existed, and on a register that sent no key. */
  did?: string;
}

export function signPosToken(
  userId: string,
  companyId: string,
  tokenVersion: number,
  deviceId?: string | null,
): string {
  const payload: PosTokenPayload = { type: 'pos', sub: userId, companyId, v: tokenVersion };
  if (deviceId) payload.did = deviceId;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

// One indexed read per request, which is the price of being able to take
// somebody's access away. Every route this guards immediately loads the
// company anyway, so the added cost is a fraction of what the request was
// already going to do — and the alternative is a token nobody can retire.
export async function requirePosAuth(req: PosAuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Не авторизовано' });
    return;
  }

  let payload: PosTokenPayload;
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET) as PosTokenPayload;
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
    return;
  }
  if (payload.type !== 'pos') {
    res.status(401).json({ error: 'Недействительный токен' });
    return;
  }

  const user = await prisma.user.findFirst({
    where: { id: payload.sub, companyId: payload.companyId },
    select: { tokenVersion: true },
  });
  // Gone, moved company, or issued before the account's access last changed.
  // Tokens minted before this field existed carry no version and read as 0,
  // which matches an account nobody has touched since — so a deploy does not
  // sign every register out.
  if (!user || user.tokenVersion !== (payload.v ?? 0)) {
    res.status(401).json({ error: 'Доступ отозван — войдите заново' });
    return;
  }

  // A device the owner has switched off. Checked after the account, because a
  // retired account is the blunter fact and deserves the blunter message.
  //
  // Tokens minted before devices existed carry no `did` and are let through: a
  // deploy must not sign the shop out. Those registers pick up a device row on
  // their next login, which is the same login they were going to do anyway
  // when the thirty days ran out.
  if (payload.did) {
    const device = await prisma.posDevice.findFirst({
      where: { id: payload.did, companyId: payload.companyId },
      select: { id: true, revokedAt: true, lastSeenAt: true },
    });
    if (!device || device.revokedAt) {
      res.status(401).json({ error: 'Это устройство отключено — обратитесь к владельцу' });
      return;
    }
    if (shouldTouchLastSeen(device.lastSeenAt, new Date())) {
      // Not every request: see LAST_SEEN_STALE_MS. The owner reads this column
      // to answer "is that tablet still out there", not to the second.
      await prisma.posDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date(), lastUserId: payload.sub },
      });
    }
    req.posDeviceId = device.id;
  }

  req.posUserId = payload.sub;
  req.posCompanyId = payload.companyId;
  next();
}
