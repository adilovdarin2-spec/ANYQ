import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { signToken, requireAuth } from '../auth';
import type { AuthedRequest } from '../auth';
import { loginRateLimit } from '../rateLimit';
import {
  generateRecoveryCodes,
  generateSecret,
  normaliseRecoveryCode,
  otpauthUri,
  verifyCode,
} from '../totp';

export const authRouter = Router();

/**
 * Spends a recovery code, if the one typed is a live one.
 *
 * Marked used inside a guarded update rather than read-then-write, so two
 * simultaneous attempts with the same code cannot both succeed. Single use is
 * the whole point: a code that works twice is a password that survived being
 * written on paper.
 */
async function spendRecoveryCode(adminUserId: string, typed: string): Promise<boolean> {
  const normalised = normaliseRecoveryCode(typed);
  if (normalised.length < 8) return false;

  const codes = await prisma.adminRecoveryCode.findMany({ where: { adminUserId, usedAt: null } });
  for (const code of codes) {
    if (!(await bcrypt.compare(normalised, code.codeHash))) continue;
    const { count } = await prisma.adminRecoveryCode.updateMany({
      where: { id: code.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }
  return false;
}

authRouter.post('/login', loginRateLimit, async (req, res) => {
  const { email, password, code } = req.body ?? {};
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

  // Asked for only after the password is known to be right. Answering
  // "second factor required" to a wrong password would tell anybody with a
  // list of emails which accounts exist and which of them are worth attacking.
  if (user.totpSecret) {
    if (typeof code !== 'string' || !code.trim()) {
      res.status(401).json({ error: 'Введите код из приложения', mfaRequired: true });
      return;
    }

    const typed = code.trim();
    const accepted = verifyCode(user.totpSecret, typed) || (await spendRecoveryCode(user.id, typed));
    if (!accepted) {
      // The same message for a wrong six-digit code and a wrong recovery code:
      // saying which was closer is help nobody legitimate needs.
      res.status(401).json({ error: 'Код неверен или уже использован', mfaRequired: true });
      return;
    }
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
  const unusedCodes = await prisma.adminRecoveryCode.count({
    where: { adminUserId: user.id, usedAt: null },
  });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    mfaEnabled: Boolean(user.totpSecret),
    // Ключ выпущен, но код с телефона ещё не вводили. Экран настроек без этого
    // предлагал «Настроить» так, будто ничего не начиналось.
    mfaPending: Boolean(user.pendingTotpSecret),
    // Shown so somebody down to their last code is told before they need it,
    // rather than after.
    recoveryCodesLeft: user.totpSecret ? unusedCodes : 0,
  });
});

/**
 * Begins enrolment: a secret to scan, not yet in force.
 *
 * The secret is stored as pending and does nothing until a working code proves
 * it reached the phone. Without that split, scanning a QR and closing the tab
 * would lock the account.
 */
authRouter.post('/mfa/setup', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.adminUser.findUnique({ where: { id: req.adminUserId } });
  if (!user) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  if (user.totpSecret) {
    res.status(409).json({ error: 'Двухфакторный вход уже включён' });
    return;
  }

  // Уже выпущенный и ждущий ключ возвращается тот же самый — если только не
  // попросили новый явно.
  //
  // Иначе получается ловушка ровно в том месте, ради которого «ожидание» и
  // придумано: человек сканирует QR, закрывает вкладку, возвращается ввести код
  // — и любое повторное открытие этого экрана молча заменяет секрет. Код с
  // телефона после этого не подходит, а сервер отвечает «проверьте время на
  // телефоне», и человек идёт крутить часы вместо того, чтобы сканировать
  // заново. То же самое ломает и выдачу ключа со стороны: тот, кому прислали
  // QR, теряет его, открыв админку.
  const wantsFresh = req.body?.fresh === true;
  const secret = !wantsFresh && user.pendingTotpSecret ? user.pendingTotpSecret : generateSecret();
  if (secret !== user.pendingTotpSecret) {
    await prisma.adminUser.update({ where: { id: user.id }, data: { pendingTotpSecret: secret } });
  }

  res.json({
    secret,
    // Чтобы экран мог сказать «этот ключ вы уже сканировали», а не показать его
    // как новый.
    reused: secret === user.pendingTotpSecret,
    // Both: the URI for a camera, the secret for somebody typing it in by hand
    // because the camera on the shop's tablet does not work.
    otpauthUri: otpauthUri(secret, user.email),
  });
});

/** Confirms the secret works, turns it on, and hands over the recovery codes. */
authRouter.post('/mfa/enable', requireAuth, async (req: AuthedRequest, res) => {
  const { code } = req.body ?? {};
  const user = await prisma.adminUser.findUnique({ where: { id: req.adminUserId } });
  if (!user) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  if (user.totpSecret) {
    res.status(409).json({ error: 'Двухфакторный вход уже включён' });
    return;
  }
  if (!user.pendingTotpSecret) {
    res.status(409).json({ error: 'Сначала отсканируйте ключ' });
    return;
  }
  if (typeof code !== 'string' || !verifyCode(user.pendingTotpSecret, code)) {
    res.status(400).json({ error: 'Код неверен — проверьте время на телефоне и попробуйте ещё раз' });
    return;
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashes = await Promise.all(
    recoveryCodes.map((plain) => bcrypt.hash(normaliseRecoveryCode(plain), 10)),
  );

  await prisma.$transaction(async (tx) => {
    // Any codes from a previous enrolment go: leaving them live would mean an
    // old printout still opens the account after the phone was replaced.
    await tx.adminRecoveryCode.deleteMany({ where: { adminUserId: user.id } });
    await tx.adminUser.update({
      where: { id: user.id },
      data: {
        totpSecret: user.pendingTotpSecret,
        pendingTotpSecret: null,
        totpEnabledAt: new Date(),
      },
    });
    await tx.adminRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ adminUserId: user.id, codeHash })),
    });
  });

  // The only time these are ever readable. Stored hashed, so there is no
  // second chance to show them and the response says so.
  res.json({
    enabled: true,
    recoveryCodes,
    note: 'Сохраните коды восстановления сейчас — больше они не покажутся.',
  });
});

/**
 * Turns it off, and requires both factors to do so.
 *
 * A session left open on an unlocked laptop would otherwise be enough to
 * remove the protection that session was supposed to need.
 */
authRouter.post('/mfa/disable', requireAuth, async (req: AuthedRequest, res) => {
  const { password, code } = req.body ?? {};
  const user = await prisma.adminUser.findUnique({ where: { id: req.adminUserId } });
  if (!user) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  if (!user.totpSecret) {
    res.status(409).json({ error: 'Двухфакторный вход не включён' });
    return;
  }

  if (typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Неверный пароль' });
    return;
  }
  const typed = typeof code === 'string' ? code.trim() : '';
  const accepted = verifyCode(user.totpSecret, typed) || (await spendRecoveryCode(user.id, typed));
  if (!accepted) {
    res.status(401).json({ error: 'Код неверен или уже использован' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: user.id },
      data: { totpSecret: null, pendingTotpSecret: null, totpEnabledAt: null },
    });
    await tx.adminRecoveryCode.deleteMany({ where: { adminUserId: user.id } });
  });

  res.json({ enabled: false });
});
