import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@anyq/db';
import {
  checkCabinetPassword,
  looksLikeCabinetSecret,
  secretsMatch,
} from '../cabinet';
import { cabinetProbeRateLimit, loginRateLimit } from '../rateLimit';
import { requireSecret } from '../secrets';
import { respondWithDashboard } from './pos';

/**
 * Кабинет владельца — только чтение, за своей ссылкой и своим паролем.
 *
 * Ни один маршрут здесь ничего не пишет, кроме двух записей о самом кабинете:
 * пароля при первой настройке и отметки о последнем входе. Это не аккуратность,
 * а несущая конструкция: дверь открыта в интернет ради денежных данных, и
 * худшее, что может случиться с украденной ссылкой и паролем, — чужой человек
 * увидит цифры. Не проведёт продажу, не поменяет цену, не спишет товар.
 *
 * Поэтому же кабинет не переиспользует ни PIN кассы, ни её токен: PIN — четыре
 * цифры, которые кассир видит каждый день, а токен кассы живёт 30 дней, потому
 * что касса обязана работать неделю без сети. Телефону владельца ни то, ни
 * другое не подходит.
 */
export const cabinetRouter = Router();

const JWT_SECRET = requireSecret('JWT_SECRET');

/**
 * Неделя.
 *
 * Не 30 дней, как у кассы: касса лежит на прилавке в магазине, а это телефон,
 * который теряют. И не час: владелец, которому каждое утро заново вводить
 * пароль, перестаёт заходить, а незаходящий владелец — это ровно тот провал,
 * ради предотвращения которого кабинет и написан.
 */
const SESSION = '7d';

interface CabinetTokenPayload {
  type: 'cabinet';
  sub: string;
  companyId: string;
  v: number;
}

interface CabinetRequest extends Request {
  cabinetId?: string;
  cabinetCompanyId?: string;
}

function signCabinetToken(cabinetId: string, companyId: string, tokenVersion: number): string {
  const payload: CabinetTokenPayload = { type: 'cabinet', sub: cabinetId, companyId, v: tokenVersion };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION });
}

/**
 * Токен кабинета — и только он.
 *
 * Проверка `type` здесь не формальность: все токены платформы подписаны одним
 * секретом, так что без неё токен кассы прошёл бы сюда как валидный, а токен
 * кабинета — в кассу. Один и тот же промах уже описан в auth.ts, и он ровно
 * такой же дорогой в обе стороны.
 */
async function requireCabinet(req: CabinetRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Не авторизовано' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as CabinetTokenPayload;
    if (payload.type !== 'cabinet') {
      res.status(401).json({ error: 'Недействительный токен' });
      return;
    }
    // Один индексированный запрос за возможность отобрать доступ. Пароль,
    // смену которого переживают старые сессии, — это не смена пароля.
    const cabinet = await prisma.ownerCabinet.findUnique({ where: { id: payload.sub } });
    if (!cabinet || cabinet.tokenVersion !== payload.v || !cabinet.passwordHash) {
      res.status(401).json({ error: 'Вход больше не действует — войдите заново' });
      return;
    }
    req.cabinetId = cabinet.id;
    req.cabinetCompanyId = cabinet.companyId;
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

/**
 * Кабинет по секрету из ссылки.
 *
 * Форма секрета проверяется до похода в базу: это отсекает и мусор, и попытки
 * подставить что-нибудь вместо строки, не занимая соединение к базе на каждый
 * перебор.
 */
async function findBySecret(raw: unknown) {
  if (!looksLikeCabinetSecret(raw)) return null;
  const cabinet = await prisma.ownerCabinet.findUnique({
    where: { secret: raw },
    include: { company: { select: { id: true, name: true, phone: true } } },
  });
  if (!cabinet) return null;
  // Уникальный индекс уже гарантирует совпадение; сравнение за постоянное
  // время стоит ноль и оставляет привычку на месте.
  return secretsMatch(cabinet.secret, raw) ? cabinet : null;
}

/**
 * Что за этой ссылкой — до всякого пароля.
 *
 * Отдаёт только название компании: этого достаточно, чтобы владелец понял, что
 * попал куда надо, и недостаточно, чтобы случайный человек что-то узнал. Ни
 * выручки, ни точек, ни имён.
 */
cabinetRouter.get('/:secret', cabinetProbeRateLimit, async (req, res) => {
  const cabinet = await findBySecret(req.params.secret);
  if (!cabinet) {
    res.status(404).json({ error: 'Такой ссылки нет' });
    return;
  }
  res.json({
    company: cabinet.company.name,
    needsPassword: cabinet.passwordHash === null,
  });
});

/**
 * Пароль задаёт владелец, сам, при первом заходе.
 *
 * Мы его не придумываем и не пересылаем: пароль, отправленный в WhatsApp,
 * остаётся в переписке навсегда и переживает и телефон, и сотрудника.
 *
 * Второй раз этот маршрут ничего не сделает — пароль уже стоит, и сменить его
 * можно только из кассы, где для этого нужен PIN владельца. Иначе тот, кто
 * нашёл ссылку, просто задал бы свой пароль поверх.
 */
cabinetRouter.post('/:secret/password', loginRateLimit, async (req, res) => {
  const cabinet = await findBySecret(req.params.secret);
  if (!cabinet) {
    res.status(404).json({ error: 'Такой ссылки нет' });
    return;
  }
  if (cabinet.passwordHash) {
    res.status(409).json({ error: 'Пароль уже задан. Сменить его можно из кассы — раздел «Кабинет владельца»' });
    return;
  }

  const verdict = checkCabinetPassword(req.body?.password, cabinet.company.phone);
  if (!verdict.ok) {
    res.status(400).json({ error: verdict.reason });
    return;
  }

  const updated = await prisma.ownerCabinet.update({
    where: { id: cabinet.id },
    data: {
      passwordHash: await bcrypt.hash(req.body.password, 10),
      passwordSetAt: new Date(),
      lastLoginAt: new Date(),
    },
  });

  res.status(201).json({ token: signCabinetToken(updated.id, updated.companyId, updated.tokenVersion) });
});

cabinetRouter.post('/:secret/login', loginRateLimit, async (req, res) => {
  const cabinet = await findBySecret(req.params.secret);
  // Одинаковый ответ на «нет такой ссылки» и «не тот пароль» здесь не нужен:
  // ссылка и так неугадываема, а владельцу, набравшему её с ошибкой, полезно
  // знать, что дело в ссылке, а не в пароле.
  if (!cabinet) {
    res.status(404).json({ error: 'Такой ссылки нет' });
    return;
  }
  if (!cabinet.passwordHash) {
    res.status(409).json({ error: 'Пароль ещё не задан — откройте ссылку и придумайте его' });
    return;
  }

  const password = req.body?.password;
  const ok = typeof password === 'string' && (await bcrypt.compare(password, cabinet.passwordHash));
  if (!ok) {
    res.status(401).json({ error: 'Неверный пароль' });
    return;
  }

  await prisma.ownerCabinet.update({ where: { id: cabinet.id }, data: { lastLoginAt: new Date() } });
  res.json({ token: signCabinetToken(cabinet.id, cabinet.companyId, cabinet.tokenVersion) });
});

/** Точки компании — владельцу с несколькими магазинами нужно выбрать. */
cabinetRouter.get('/session/locations', requireCabinet, async (req: CabinetRequest, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.cabinetCompanyId },
    select: { name: true, locations: { select: { id: true, name: true }, orderBy: { name: 'asc' } } },
  });
  res.json({ company: company?.name ?? '', locations: company?.locations ?? [] });
});

/**
 * Те же цифры, что видит касса, — и намеренно те же самые.
 *
 * Считать выручку второй раз для второго экрана означало бы завести второй
 * источник правды: первое же расхождение между кассой и кабинетом обошлось бы
 * дороже, чем весь кабинет.
 */
cabinetRouter.get('/session/summary', requireCabinet, async (req: CabinetRequest, res) => {
  await respondWithDashboard(req.cabinetCompanyId!, req.query, res);
});
