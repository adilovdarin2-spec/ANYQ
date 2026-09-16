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
import type { AuditActor } from '../audit-log';
import { createStaff, listStaff, updateStaff } from '../staff-operations';
import {
  generateRecoveryCodes,
  generateSecret,
  normaliseRecoveryCode,
  otpauthUri,
  verifyCode,
} from '../totp';
import { requireSecret } from '../secrets';
import { respondWithDashboard } from './pos';
import { expiryFrom, grantState, isOpen } from '../support-access';

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
/**
 * Потратить код восстановления — ровно один раз.
 *
 * Отметка ставится защищённым обновлением, а не «прочитали и записали»: две
 * одновременные попытки одним кодом не должны обе пройти. Одноразовость и есть
 * весь смысл — код, срабатывающий дважды, это пароль, переживший запись на
 * бумаге.
 */
async function spendCabinetRecoveryCode(cabinetId: string, typed: string): Promise<boolean> {
  const normalised = normaliseRecoveryCode(typed);
  if (normalised.length < 8) return false;

  const codes = await prisma.cabinetRecoveryCode.findMany({ where: { cabinetId, usedAt: null } });
  for (const code of codes) {
    if (!(await bcrypt.compare(normalised, code.codeHash))) continue;
    const { count } = await prisma.cabinetRecoveryCode.updateMany({
      where: { id: code.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }
  return false;
}

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

  // Код спрашивается только после того, как пароль оказался верен.
  //
  // Ответить «нужен код» на неверный пароль значило бы сказать нашедшему
  // ссылку, что за ней есть кабинет с включённой защитой, — то есть что она
  // живая и её стоит подбирать дальше.
  if (cabinet.totpSecret) {
    const typed = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!typed) {
      res.status(401).json({ error: 'Введите код из приложения', mfaRequired: true });
      return;
    }
    const accepted = verifyCode(cabinet.totpSecret, typed) || (await spendCabinetRecoveryCode(cabinet.id, typed));
    if (!accepted) {
      // Один и тот же ответ на неверный шестизначный код и на неверный код
      // восстановления: подсказка, какой из них был ближе, не нужна никому,
      // кто пришёл по праву.
      res.status(401).json({ error: 'Код неверен или уже использован', mfaRequired: true });
      return;
    }
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

/**
 * Кто и зачем просил посмотреть ваши цифры.
 *
 * Отдаётся весь список, включая отклонённое и истёкшее: владелец должен видеть
 * не только то, что он разрешил, но и то, о чём его просили и как часто. Если
 * запросов вдруг стало по три в неделю — это разговор, который лучше начать
 * ему, чем нам.
 */
cabinetRouter.get('/session/support', requireCabinet, async (req: CabinetRequest, res) => {
  const rows = await prisma.supportAccess.findMany({
    where: { companyId: req.cabinetCompanyId },
    orderBy: { requestedAt: 'desc' },
    take: 50,
  });
  const now = new Date();

  res.json({
    requests: rows.map((row) => ({
      id: row.id,
      state: grantState(row, now),
      who: row.requestedByName,
      reason: row.reason,
      requestedAt: row.requestedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      // Разрешение, которым не воспользовались, и разрешение, по которому
      // смотрели весь день, — разные вещи.
      firstUsedAt: row.firstUsedAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    })),
  });
});

/**
 * Открыть доступ на сутки, отказать или закрыть раньше срока.
 *
 * Одно действие на один запрос, и ответить на уже отвеченный нельзя: иначе
 * «отказал» можно было бы переиграть в «разрешил» второй кнопкой, и запись
 * перестала бы значить то, что в ней написано.
 */
cabinetRouter.post('/session/support/:id/:action', requireCabinet, async (req: CabinetRequest, res) => {
  const { action } = req.params;
  if (action !== 'grant' && action !== 'decline' && action !== 'revoke') {
    res.status(400).json({ error: 'Неизвестное действие' });
    return;
  }

  const row = await prisma.supportAccess.findFirst({
    where: { id: req.params.id, companyId: req.cabinetCompanyId },
  });
  if (!row) {
    res.status(404).json({ error: 'Запрос не найден' });
    return;
  }

  const now = new Date();
  const state = grantState(row, now);

  if (action === 'revoke') {
    // Закрыть можно только открытое. «Закрыть» истёкшее — это не действие, а
    // непонимание, и отвечать на него «готово» значило бы его закрепить.
    if (!isOpen(row, now)) {
      res.status(409).json({ error: 'Этот доступ и так закрыт' });
      return;
    }
    await prisma.supportAccess.update({ where: { id: row.id }, data: { revokedAt: now } });
    res.json({ state: 'revoked' });
    return;
  }

  if (state !== 'pending') {
    res.status(409).json({ error: 'На этот запрос уже ответили' });
    return;
  }

  if (action === 'decline') {
    await prisma.supportAccess.update({ where: { id: row.id }, data: { declinedAt: now } });
    res.json({ state: 'declined' });
    return;
  }

  const expiresAt = expiryFrom(now);
  await prisma.supportAccess.update({ where: { id: row.id }, data: { grantedAt: now, expiresAt } });
  res.json({ state: 'active', expiresAt: expiresAt.toISOString() });
});

/**
 * Второй фактор у кабинета.
 *
 * Кабинет был дверью только на чтение, и замка ему хватало одного: худшее, что
 * делала украденная ссылка с паролем, — показывала цифры. Управление PIN-ами
 * сотрудников это меняет. Тот же украденный адрес становится входом в кассу:
 * поменял PIN кассиру, вошёл этим PIN-ом, торгуешь — и это уже не подглядывание,
 * а торговля от чужого имени.
 *
 * Поэтому здесь не настройка «для желающих», а условие: PIN-ы в кабинете
 * доступны только при включённом втором факторе. Порядок именно такой — сперва
 * замок, потом то, что он запирает.
 */
cabinetRouter.get('/session/security', requireCabinet, async (req: CabinetRequest, res) => {
  const cabinet = await prisma.ownerCabinet.findUnique({
    where: { id: req.cabinetId },
    include: { recoveryCodes: { where: { usedAt: null }, select: { id: true } } },
  });
  if (!cabinet) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json({
    enabled: !!cabinet.totpSecret,
    enabledAt: cabinet.totpEnabledAt?.toISOString() ?? null,
    // Чтобы экран мог сказать «ключ вы уже сканировали», а не показать его как
    // новый — та же ловушка, что чинили у админки 10.09.2026.
    pending: !!cabinet.pendingTotpSecret,
    recoveryCodesLeft: cabinet.recoveryCodes.length,
  });
});

cabinetRouter.post('/session/security/setup', requireCabinet, async (req: CabinetRequest, res) => {
  const cabinet = await prisma.ownerCabinet.findUnique({
    where: { id: req.cabinetId },
    include: { company: { select: { name: true } } },
  });
  if (!cabinet) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  if (cabinet.totpSecret) {
    res.status(409).json({ error: 'Двухфакторный вход уже включён' });
    return;
  }

  // Уже выпущенный и ждущий ключ возвращается тот же самый, если не попросили
  // новый явно. Иначе ловушка ровно там, ради чего «ожидание» и придумано:
  // владелец сканирует QR, закрывает вкладку, возвращается ввести код — а
  // повторное открытие экрана молча заменило секрет, и код не подходит.
  const wantsFresh = req.body?.fresh === true;
  const secret = !wantsFresh && cabinet.pendingTotpSecret ? cabinet.pendingTotpSecret : generateSecret();
  const reused = secret === cabinet.pendingTotpSecret;
  if (!reused) {
    await prisma.ownerCabinet.update({ where: { id: cabinet.id }, data: { pendingTotpSecret: secret } });
  }

  res.json({
    secret,
    reused,
    // И то, и другое: ссылка для камеры и сам ключ для того, кто вводит
    // руками, потому что камера на телефоне не открылась.
    otpauthUri: otpauthUri(secret, `${cabinet.company.name} · кабинет`),
  });
});

/** Подтверждает, что ключ работает, включает замок и отдаёт коды восстановления. */
cabinetRouter.post('/session/security/enable', requireCabinet, async (req: CabinetRequest, res) => {
  const cabinet = await prisma.ownerCabinet.findUnique({ where: { id: req.cabinetId } });
  if (!cabinet) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  if (cabinet.totpSecret) {
    res.status(409).json({ error: 'Двухфакторный вход уже включён' });
    return;
  }
  if (!cabinet.pendingTotpSecret) {
    res.status(409).json({ error: 'Сначала отсканируйте ключ' });
    return;
  }
  const code = req.body?.code;
  if (typeof code !== 'string' || !verifyCode(cabinet.pendingTotpSecret, code)) {
    res.status(400).json({ error: 'Код неверен — проверьте время на телефоне и попробуйте ещё раз' });
    return;
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashes = await Promise.all(
    recoveryCodes.map((plain) => bcrypt.hash(normaliseRecoveryCode(plain), 10)),
  );

  const locked = await prisma.$transaction(async (tx) => {
    // Коды с прошлого раза удаляются: оставить их живыми значило бы, что старая
    // распечатка открывает кабинет после смены телефона.
    await tx.cabinetRecoveryCode.deleteMany({ where: { cabinetId: cabinet.id } });
    const updated = await tx.ownerCabinet.update({
      where: { id: cabinet.id },
      data: {
        totpSecret: cabinet.pendingTotpSecret,
        pendingTotpSecret: null,
        totpEnabledAt: new Date(),
        // Все прежние входы — прочь. Это и есть весь смысл: замок вешают,
        // когда ссылку с паролем могли узнать, а сессия кабинета живёт неделю.
        // Второй фактор, который переживают старые сессии, не заперт ни для
        // кого, кроме самого владельца, — то же самое уже сказано про пароль
        // строчкой в `requireCabinet`.
        tokenVersion: { increment: 1 },
      },
    });
    await tx.cabinetRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ cabinetId: cabinet.id, codeHash })),
    });
    return updated;
  });

  res.json({
    enabled: true,
    // Свежий токен тому, кто замок и повесил: выкинуть его вместе со всеми
    // значило бы заставить входить заново ровно в ту минуту, когда он
    // настраивает. Чужие входы при этом всё равно погашены.
    token: signCabinetToken(locked.id, locked.companyId, locked.tokenVersion),
    // Единственный раз, когда их видно. Хранятся хешем, второго раза нет — и
    // ответ говорит об этом прямо.
    recoveryCodes,
    note: 'Сохраните коды восстановления сейчас — больше они не покажутся.',
  });
});

/**
 * Выключает — и требует для этого обоих факторов.
 *
 * Открытая вкладка на чужом телефоне иначе снимала бы ровно ту защиту, ради
 * которой она и заводилась. Пароль здесь спрашивается не для вежливости: сессия
 * у того, кто её открыл, уже есть.
 */
cabinetRouter.post('/session/security/disable', requireCabinet, async (req: CabinetRequest, res) => {
  const cabinet = await prisma.ownerCabinet.findUnique({ where: { id: req.cabinetId } });
  if (!cabinet) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  if (!cabinet.totpSecret) {
    res.status(409).json({ error: 'Двухфакторный вход не включён' });
    return;
  }

  const password = req.body?.password;
  const passwordOk =
    typeof password === 'string' &&
    !!cabinet.passwordHash &&
    (await bcrypt.compare(password, cabinet.passwordHash));
  if (!passwordOk) {
    res.status(401).json({ error: 'Неверный пароль' });
    return;
  }

  const typed = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const accepted = verifyCode(cabinet.totpSecret, typed) || (await spendCabinetRecoveryCode(cabinet.id, typed));
  if (!accepted) {
    res.status(401).json({ error: 'Код неверен или уже использован' });
    return;
  }

  const unlocked = await prisma.$transaction(async (tx) => {
    const updated = await tx.ownerCabinet.update({
      where: { id: cabinet.id },
      // Снятие замка — тоже изменение доступа, и старые входы переживать его не
      // должны: сессия, открытая при включённом втором факторе на чужом
      // устройстве, после снятия оказалась бы сильнее, чем была.
      data: {
        totpSecret: null,
        pendingTotpSecret: null,
        totpEnabledAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    await tx.cabinetRecoveryCode.deleteMany({ where: { cabinetId: cabinet.id } });
    return updated;
  });

  res.json({
    enabled: false,
    token: signCabinetToken(unlocked.id, unlocked.companyId, unlocked.tokenVersion),
  });
});

/**
 * Сотрудники из кабинета — и только при включённом втором факторе.
 *
 * Это не настройка строгости, а условие существования этих маршрутов. Кабинет
 * открыт в интернет, и до сих пор его худший исход был «чужой человек увидел
 * цифры». PIN даёт другое: поменял кассиру, вошёл этим PIN-ом, торгуешь от
 * чужого имени — и обнаружится это на сверке смены, если обнаружится вообще.
 *
 * Поэтому замок проверяется на каждом запросе, а не однажды при включении.
 * Владелец, выключивший второй фактор, теряет PIN-ы из кабинета в ту же
 * секунду: иначе «включил, сделал, выключил» оставляло бы дверь открытой.
 *
 * Сами правила — в `staff-operations.ts`, одни и те же с кассой. Вход другой,
 * люди те же.
 */
async function requireSecondFactor(req: CabinetRequest, res: Response): Promise<boolean> {
  const cabinet = await prisma.ownerCabinet.findUnique({ where: { id: req.cabinetId } });
  if (!cabinet?.totpSecret) {
    res.status(403).json({
      error: 'Включите двухфакторный вход — без него PIN-ы из кабинета не выдаются',
      needsSecondFactor: true,
    });
    return false;
  }
  return true;
}

/**
 * Подпись в журнале — «кабинет владельца», а не «неизвестно».
 *
 * Владельца, вошедшего по ссылке, среди сотрудников может не быть вовсе, и
 * `resolveActor` записал бы «неизвестно». Но тот, кто через полгода будет
 * разбирать, почему у кассира сменился PIN, должен видеть не пробел, а откуда
 * это сделали: из кабинета или с терминала в зале.
 */
function cabinetActor(companyId: string): AuditActor {
  return { companyId, actorId: null, actorName: 'кабинет владельца' };
}

cabinetRouter.get('/session/staff', requireCabinet, async (req: CabinetRequest, res) => {
  if (!(await requireSecondFactor(req, res))) return;
  res.json(await listStaff(req.cabinetCompanyId!));
});

cabinetRouter.post('/session/staff', requireCabinet, async (req: CabinetRequest, res) => {
  if (!(await requireSecondFactor(req, res))) return;
  const outcome = await createStaff(req.cabinetCompanyId!, cabinetActor(req.cabinetCompanyId!), req.body ?? {});
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  res.status(201).json(outcome.value);
});

cabinetRouter.patch('/session/staff/:id', requireCabinet, async (req: CabinetRequest, res) => {
  if (!(await requireSecondFactor(req, res))) return;
  // Действующего сотрудника здесь нет: владелец вошёл ссылкой, а не PIN-ом.
  // Значит нет и запрета «не понижай сам себя» — понижать некого. Запрет на
  // последнего владельца остаётся: он про компанию, а не про того, кто нажал.
  const outcome = await updateStaff(
    req.cabinetCompanyId!,
    cabinetActor(req.cabinetCompanyId!),
    null,
    req.params.id,
    req.body ?? {},
  );
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  res.json(outcome.value);
});
