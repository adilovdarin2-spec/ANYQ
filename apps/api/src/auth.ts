import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'anyq-dev-secret-change-me';

export interface AuthedRequest extends Request {
  adminUserId?: string;
}

interface AdminTokenPayload {
  type: 'admin';
  sub: string;
}

export function signToken(adminUserId: string): string {
  const payload: AdminTokenPayload = { type: 'admin', sub: adminUserId };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

// pos-auth.ts signs its own tokens with a 'pos' type using this same secret —
// without checking type here, a POS cashier's PIN-login token would decode
// successfully (same signature) and pass as a superadmin session.
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Не авторизовано' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as AdminTokenPayload;
    if (payload.type !== 'admin') {
      res.status(401).json({ error: 'Недействительный токен' });
      return;
    }
    req.adminUserId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}
