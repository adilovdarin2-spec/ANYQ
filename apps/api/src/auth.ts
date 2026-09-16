import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@anyq/db';
import { requireSecret } from './secrets';

const JWT_SECRET = requireSecret('JWT_SECRET');

export interface AuthedRequest extends Request {
  adminUserId?: string;
}

interface AdminTokenPayload {
  type: 'admin';
  sub: string;
  /** Версия доступа, с которой токен выдан. См. `tokenVersion` в схеме. */
  v: number;
}

export function signToken(adminUserId: string, tokenVersion: number): string {
  const payload: AdminTokenPayload = { type: 'admin', sub: adminUserId, v: tokenVersion };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

// pos-auth.ts signs its own tokens with a 'pos' type using this same secret —
// without checking type here, a POS cashier's PIN-login token would decode
// successfully (same signature) and pass as a superadmin session.
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
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
    // Один индексированный запрос за возможность отобрать доступ.
    //
    // До 16.09.2026 его здесь не было, и сессию этой учётной записи нельзя
    // было отозвать ничем: выданный токен жил свои семь дней. Включение
    // второго фактора его не касалось — а включают второй фактор обычно
    // тогда, когда есть подозрение, что пароль узнали, то есть когда чужая
    // сессия уже открыта. За этой дверью все компании сразу, и цена такой
    // экономии выше, чем стоит запрос.
    const user = await prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { tokenVersion: true },
    });
    if (!user || user.tokenVersion !== payload.v) {
      res.status(401).json({ error: 'Вход больше не действует — войдите заново' });
      return;
    }
    req.adminUserId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}
