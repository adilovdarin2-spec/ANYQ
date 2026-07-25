import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { signToken, requireAuth } from '../auth';
import type { AuthedRequest } from '../auth';
import { loginRateLimit } from '../rateLimit';

export const authRouter = Router();

authRouter.post('/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'Введите email и пароль' });
    return;
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Неверный email или пароль' });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'Неверный email или пароль' });
    return;
  }

  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.adminUser.findUnique({ where: { id: req.adminUserId } });
  if (!user) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json({ id: user.id, email: user.email, name: user.name });
});
