import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@anyq/db';
import { requireSecret } from './secrets';

const JWT_SECRET = requireSecret('JWT_SECRET');

export interface PosAuthedRequest extends Request {
  posUserId?: string;
  posCompanyId?: string;
}

interface PosTokenPayload {
  type: 'pos';
  sub: string;
  companyId: string;
  /** The account's token version when this was minted. See User.tokenVersion. */
  v?: number;
}

export function signPosToken(userId: string, companyId: string, tokenVersion: number): string {
  const payload: PosTokenPayload = { type: 'pos', sub: userId, companyId, v: tokenVersion };
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

  req.posUserId = payload.sub;
  req.posCompanyId = payload.companyId;
  next();
}
