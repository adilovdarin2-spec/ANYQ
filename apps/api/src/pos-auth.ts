import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'anyq-dev-secret-change-me';

export interface PosAuthedRequest extends Request {
  posUserId?: string;
  posCompanyId?: string;
}

interface PosTokenPayload {
  type: 'pos';
  sub: string;
  companyId: string;
}

export function signPosToken(userId: string, companyId: string): string {
  const payload: PosTokenPayload = { type: 'pos', sub: userId, companyId };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function requirePosAuth(req: PosAuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Не авторизовано' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as PosTokenPayload;
    if (payload.type !== 'pos') {
      res.status(401).json({ error: 'Недействительный токен' });
      return;
    }
    req.posUserId = payload.sub;
    req.posCompanyId = payload.companyId;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}
