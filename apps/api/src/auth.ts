import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'anyq-dev-secret-change-me';

export interface AuthedRequest extends Request {
  adminUserId?: string;
}

export function signToken(adminUserId: string): string {
  return jwt.sign({ sub: adminUserId }, JWT_SECRET, { expiresIn: '7d' });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Не авторизовано' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string };
    req.adminUserId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}
