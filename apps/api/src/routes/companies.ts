import { Router } from 'express';
import type { Response } from 'express';
import { prisma, Prisma } from '@anyq/db';
import { limitRefusal } from '../limits';
import { moduleListRefusal } from '../modules';
import { roleRefusal } from '../roles';
import { phoneKey } from '../phone';
import { requireAuth } from '../auth';
import type { AuthedRequest } from '../auth';
import { recordChanges } from '../audit-log';
import { computeDiscount } from '../discounts';
import { paymentsOrLegacy, totalsByMethod } from '../payments';
import { expiryFrom, grantState, isOpen, reasonRefusal, refusalFor } from '../support-access';
import type { PaymentLine } from '../payments';

export const companiesRouter = Router();
companiesRouter.use(requireAuth);

// `users` берётся ради счёта, а не ради имён: наружу уходит только их
// количество. `posDevices` — ради даты последней связи, по которой видно,
// насколько это число свежее.
const include = {
  locations: true,
  users: { select: { id: true } },
  posDevices: { select: { lastSeenAt: true } },
  tariff: true,
} satisfies Prisma.CompanyInclude;
type CompanyWithRelations = Prisma.CompanyGetPayload<{ include: typeof include }>;

// Cyrillic (Russian + Kazakh) transliteration — company names on this
// platform are almost always Cyrillic, and a bare cuid makes for an
// unshareable storefront link.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  қ: 'q', ғ: 'g', ң: 'ng', ү: 'u', ұ: 'u', һ: 'h', і: 'i', ә: 'a', ө: 'o',
};

function slugify(name: string): string {
  let out = '';
  for (const ch of name.toLowerCase()) {
    if (CYRILLIC_TO_LATIN[ch] !== undefined) out += CYRILLIC_TO_LATIN[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company';
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let i = 2;
  while (await prisma.company.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${i}`;
    i++;
  }
  return candidate;
}

/**
 * Когда магазин последний раз выходил на связь.
 *
 * По самому свежему из его терминалов: у магазина их может быть несколько, и
 * молчащая запасная касса ничего не говорит о работающей основной. `null` —
 * это «ещё ни разу», а не «давно»: компания, заведённая утром и ещё не
 * включённая, и компания, замолчавшая месяц назад, — разные вещи.
 */
function lastSeen(devices: { lastSeenAt: Date }[]): string | null {
  if (devices.length === 0) return null;
  const latest = devices.reduce((a, b) => (a.lastSeenAt > b.lastSeenAt ? a : b));
  return latest.lastSeenAt.toISOString();
}

function serializeCompany(company: CompanyWithRelations) {
  return {
    id: company.id,
    name: company.name,
    phone: company.phone,
    slug: company.slug,
    createdAt: company.createdAt.toISOString().slice(0, 10),
    locations: company.locations.map((l) => ({ id: l.id, name: l.name, type: l.type, address: l.address ?? '' })),
    /**
     * Сотрудники — числом, а не поимённо.
     *
     * Тарифы делятся на их количество, а не на их имена, и это ровно та
     * граница, по которой проходит всё остальное здесь: нам нужно знать, за
     * сколько человек заплачено и укладывается ли магазин в тариф. Имена и
     * телефоны чужих сотрудников — их дело; с 15.09.2026 список ведёт
     * владелец у себя в кассе.
     *
     * `lastSeenAt` — когда магазин последний раз выходил на связь. Это и есть
     * «данные на такое-то число»: терминал, месяц не подключавшийся к сети, не
     * должен выглядеть как свежий.
     */
    staff: {
      count: company.users.length,
      limit: company.tariff?.userLimit ?? null,
      lastSeenAt: lastSeen(company.posDevices),
    },
    tariff: company.tariff && {
      modules: JSON.parse(company.tariff.modules) as string[],
      locationLimit: company.tariff.locationLimit,
      userLimit: company.tariff.userLimit,
      skuLimit: company.tariff.skuLimit,
      supportLevel: company.tariff.supportLevel,
      validUntil: company.tariff.validUntil.toISOString().slice(0, 10),
      blocked: company.tariff.blocked,
      notes: company.tariff.notes ?? '',
    },
  };
}

/** Четыре-шесть цифр: столько кассир согласен набирать по сто раз в день. */
const PIN_PATTERN = /^\d{4,6}$/;
const PIN_TAKEN = 'Этот PIN уже используется другим сотрудником';

companiesRouter.get('/', async (_req, res) => {
  const companies = await prisma.company.findMany({ include, orderBy: { createdAt: 'desc' } });
  res.json(companies.map(serializeCompany));
});

companiesRouter.post('/', async (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.phone || !b.location?.name || !b.owner?.name) {
    res.status(400).json({ error: 'Заполните название, телефон, точку и владельца' });
    return;
  }

  // Модуль, которого не бывает, ничего не включает и выглядит включённым.
  const modulesRefusal = moduleListRefusal(b.tariff?.modules);
  if (modulesRefusal) {
    res.status(400).json({ error: modulesRefusal });
    return;
  }

  const validUntil = readValidUntil(b.tariff?.validUntil);
  if (!validUntil) {
    res.status(400).json({ error: VALID_UNTIL_REQUIRED });
    return;
  }

  // PIN владельца — здесь же, а не отдельным заходом.
  //
  // До этого компания создавалась с владельцем без PIN, то есть владелец не мог
  // войти никуда, пока кто-то не вспомнит зайти в карточку сотрудников и
  // дописать код. Никто об этом не напоминал, и обнаруживается это через
  // неделю словами «а я и не заходил ни разу». Поле необязательное: раздать
  // PIN позже по-прежнему можно.
  const ownerPin = typeof b.owner?.posPin === 'string' ? b.owner.posPin.trim() : '';
  if (ownerPin && !PIN_PATTERN.test(ownerPin)) {
    res.status(400).json({ error: 'PIN должен быть числом из 4–6 цифр' });
    return;
  }
  if (ownerPin) {
    // PIN уникален на всю платформу: два человека с одним кодом — это две
    // смены, записанные на одного.
    const clash = await prisma.user.findFirst({ where: { posPin: ownerPin } });
    if (clash) {
      res.status(409).json({ error: PIN_TAKEN });
      return;
    }
  }

  const slug = await generateUniqueSlug(b.name);

  const company = await prisma.company.create({
    data: {
      name: b.name,
      // К одному виду, как и у контрагентов: один и тот же номер, записанный
      // «8 701 …» в одной строке и «+7 701 …» в соседней, — это список, по
      // которому неудобно ни звонить, ни искать.
      phone: phoneKey(b.phone),
      slug,
      locations: { create: [{ name: b.location.name, type: b.location.type, address: b.location.address ?? '' }] },
      users: { create: [{ name: b.owner.name, role: 'owner', phone: phoneKey(b.owner.phone ?? ''), posPin: ownerPin || null }] },
      tariff: {
        create: {
          modules: JSON.stringify(b.tariff?.modules ?? []),
          locationLimit: b.tariff?.locationLimit ?? null,
          userLimit: b.tariff?.userLimit ?? null,
          skuLimit: b.tariff?.skuLimit ?? null,
          supportLevel: b.tariff?.supportLevel ?? 'basic',
          validUntil,
          blocked: false,
          notes: b.tariff?.notes ?? '',
        },
      },
    },
    include,
  });

  res.status(201).json(serializeCompany(company));
});

/*
 * Товаров чужого магазина здесь нет, и это не пропуск.
 *
 * До 15.09.2026 панель платформы читала и правила чужой каталог: названия,
 * цены продажи и — главное — закупочные, то есть наценку магазина и его
 * договорённости с поставщиками. И могла эти цены менять.
 *
 * Магазин заводит и правит каталог сам, из кассы: `POST /pos/products`,
 * `PATCH /pos/products/:id`, импорт прайса, перенос из старой программы. Эти
 * маршруты существовали только затем, чтобы делать это за него, — а заодно
 * видеть то, что видеть незачем.
 *
 * Закрыть их за разрешением владельца, как сделано со сменами, было бы
 * полумерой: у смен есть повод — «у меня не сходится выручка», — а у чужого
 * прайса повода нет. Дверь, которой незачем быть, лучше не запирать, а убрать.
 */

/**
 * Последний запрос доступа к этой компании, каким бы он ни был.
 *
 * Именно последний, а не последний разрешённый: отклонённый запрос — тоже
 * ответ, и «владелец отказал» должно звучать как отказ, а не как «доступа
 * нет». Разница видна на экране того, кто просил.
 */
async function latestGrant(companyId: string) {
  return prisma.supportAccess.findFirst({
    where: { companyId },
    orderBy: { requestedAt: 'desc' },
  });
}

/**
 * Пропустить к чужим цифрам — или объяснить, почему нет.
 *
 * Отмечает и то, что доступом воспользовались: разрешение, по которому никто
 * не посмотрел, и разрешение, по которому смотрели весь день, — разные вещи, и
 * владелец вправе их различать.
 */
async function allowSupport(companyId: string, res: Response): Promise<boolean> {
  const grant = await latestGrant(companyId);
  const now = new Date();
  if (!isOpen(grant, now)) {
    res.status(403).json({ error: refusalFor(grantState(grant, now)), supportState: grantState(grant, now) });
    return false;
  }
  await prisma.supportAccess.update({
    where: { id: grant!.id },
    data: { firstUsedAt: grant!.firstUsedAt ?? now, lastUsedAt: now },
  });
  return true;
}

/** Что панель платформы знает про свой доступ к этой компании. */
companiesRouter.get('/:id/support-access', async (req, res) => {
  const grant = await latestGrant(req.params.id);
  const now = new Date();
  res.json({
    state: grantState(grant, now),
    reason: grant?.reason ?? '',
    requestedAt: grant?.requestedAt.toISOString() ?? null,
    expiresAt: grant?.expiresAt?.toISOString() ?? null,
  });
});

/**
 * Попросить владельца открыть доступ.
 *
 * Причина обязательна и пишется своими словами: владелец решает по ней и
 * больше ни по чему. Запрос поверх уже открытого доступа — не ошибка, а
 * продление, и отказывать в нём значило бы заставить ждать истечения.
 */
companiesRouter.post('/:id/support-access', async (req: AuthedRequest, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const refusal = reasonRefusal(reason);
  if (refusal) {
    res.status(400).json({ error: refusal });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!company) {
    res.status(404).json({ error: 'Компания не найдена' });
    return;
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: req.adminUserId }, select: { name: true } });
  const created = await prisma.supportAccess.create({
    data: {
      companyId: company.id,
      requestedById: req.adminUserId ?? '',
      // Имя сохраняется отдельно от ссылки: учётную запись переименуют или
      // закроют, а в журнале должно остаться имя, которое владелец видел.
      requestedByName: admin?.name ?? 'Администратор платформы',
      reason,
    },
  });

  res.status(201).json({ id: created.id, state: 'pending', requestedAt: created.requestedAt.toISOString() });
});

companiesRouter.get('/:id/shifts', async (req, res) => {
  // Сколько магазин зарабатывает — не наше дело, пока владелец не попросил
  // помочь и не открыл это сам.
  if (!(await allowSupport(req.params.id, res))) return;

  const shifts = await prisma.shift.findMany({
    where: { companyId: req.params.id },
    orderBy: { openedAt: 'desc' },
    take: 20,
  });

  const result = await Promise.all(
    shifts.map(async (shift) => {
      // Two cashiers can have overlapping open shifts at the same location
      // (a second register, a shift-change overlap) — without scoping by
      // who actually rang each sale, both shifts' reports would show the
      // same commingled total. Older shifts predate the userId column, so
      // they fall back to the location+time-only match they've always used.
      const sales = await prisma.document.findMany({
        where: {
          locationId: shift.locationId,
          type: 'sale',
          createdAt: { gte: shift.openedAt, ...(shift.closedAt ? { lte: shift.closedAt } : {}) },
          ...(shift.userId ? { createdBy: shift.userId } : {}),
        },
        include: { items: true, payments: true },
      });

      // Что покупатель заплатил на самом деле: со скидкой и списанными
      // баллами. Сумма позиций — это цена до разговора у кассы, и по ней
      // поддержка считала выручку, которой в ящике никогда не было.
      const totals = sales.map((sale) => {
        const subtotal = sale.items.reduce((sum, it) => sum + Math.round(it.price * it.quantity), 0);
        const discount = computeDiscount(subtotal, sale.discountType
          ? { type: sale.discountType as 'percent' | 'fixed', value: sale.discountValue ?? 0 }
          : null).discountAmount;
        return { sale, total: subtotal - discount - (sale.pointsRedeemed ?? 0) };
      });

      const total = totals.reduce((sum, row) => sum + row.total, 0);
      // По частям, а не по пометке на чеке. У чека, разбитого между картой и
      // наличными, способ оплаты — «mixed», и вся его сумма падала в графу
      // «mixed»: в наличных её не было, а поддержка считает ожидаемую сумму в
      // ящике именно по наличным. То есть на экране, куда смотрят, когда
      // владелец звонит про расхождение, было расхождение.
      const byMethod = totalsByMethod(
        totals.map(({ sale, total: saleTotal }) => ({
          payments: paymentsOrLegacy(sale.payments as PaymentLine[] | undefined, sale.paymentMethod, saleTotal),
        })),
      );

      return {
        id: shift.id,
        cashierName: shift.cashierName,
        openedAt: shift.openedAt.toISOString(),
        openingCash: shift.openingCash,
        closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
        closingCashCounted: shift.closingCashCounted,
        salesCount: sales.length,
        totalSales: total,
        totalsByMethod: byMethod,
      };
    }),
  );

  res.json(result);
});





/**
 * Сотрудник глазами админки платформы — без PIN-кода.
 *
 * PIN отсюда больше не выходит, и это не про «лишние данные на экране». PIN —
 * это вход в кассу: зная его, можно войти в чужой магазин и продавать от имени
 * этого кассира. Панель платформы, показывающая PIN каждого кассира каждой
 * компании, — это не список сотрудников, это связка ключей от всех дверей.
 *
 * Задать PIN по-прежнему можно: его вводит человек, который заводит
 * сотрудника, и в эту секунду он его знает. Прочитать обратно — нельзя.
 * Забыли — задайте новый; это дешевле, чем хранить связку.
 *
 * `hasPin` остаётся, потому что разница между «доступа к кассе нет» и «есть,
 * но я его не вижу» — это разница, которую видно на экране и по которой
 * принимают решения.
 */
function serializeUser(u: { id: string; name: string; role: string; phone: string | null; posPin: string | null }) {
  return { id: u.id, name: u.name, role: u.role, phone: u.phone ?? '', hasPin: u.posPin !== null };
}


/**
 * The date the tariff runs out, or null if what arrived was not one.
 *
 * Checked rather than handed to `new Date` and hoped for: an absent or malformed
 * value becomes an Invalid Date, Prisma refuses to store it, and the operator
 * gets a 500 with no field named. This is also the one tariff field with no
 * sensible default — a tariff with no end is a decision somebody has to make,
 * not something to guess at while creating a company.
 */
function readValidUntil(raw: unknown): Date | null {
  if (typeof raw !== 'string' && !(raw instanceof Date) && typeof raw !== 'number') return null;
  const parsed = new Date(raw as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const VALID_UNTIL_REQUIRED = 'Укажите дату окончания тарифа (ГГГГ-ММ-ДД)';

// posPin is looked up globally (not scoped by company) at /pos/login, so it
// must be unique across every company on the platform, not just this one.
//
// The check below is kept because it gives a decent message; the guarantee is
// the unique index. The check alone was a check-then-write two admins could
// both win, and the loser's cashier would have signed into the winner's shop.

/** True when Postgres refused the write because the PIN is already spoken for. */
function isPinConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002' &&
    JSON.stringify((err as { meta?: unknown }).meta ?? '').includes('posPin')
  );
}


function serializeLocation(l: { id: string; name: string; type: string; address: string | null }) {
  return { id: l.id, name: l.name, type: l.type, address: l.address ?? '' };
}

// No delete route — Location is referenced by Stock/Document/Shift/ProductBatch
// FKs with no cascade, so Postgres would reject it anyway once any activity
// has happened at that location. Matches the no-delete precedent for products/users.
/**
 * Выдать владельцу PIN — первый или взамен потерянного.
 *
 * Единственное, что панель платформы делает с людьми магазина, и единственное,
 * чего она не может не делать: без PIN-а владелец не войдёт в кассу, а завести
 * себе PIN, не войдя, нельзя. Это и есть «даю им данные для входа».
 *
 * Всё остальное про сотрудников отсюда убрано 15.09.2026. Раньше здесь заводили
 * и правили кого угодно: мы держали имена и телефоны чужих сотрудников, а
 * владелец, у которого уволился кассир, звонил нам менять PIN. Теперь список
 * ведёт он сам (`POST /pos/users`), а мы видим только их количество.
 *
 * Только владельцу и только PIN. Ни имени, ни роли, ни чужих людей: узкий
 * маршрут, который нельзя случайно расширить, лучше общего с проверками внутри.
 */
companiesRouter.post('/:id/owner-pin', async (req: AuthedRequest, res) => {
  const posPin = typeof req.body?.posPin === 'string' ? req.body.posPin.trim() : '';
  if (!PIN_PATTERN.test(posPin)) {
    res.status(400).json({ error: 'PIN должен быть числом из 4–6 цифр' });
    return;
  }

  const owner = await prisma.user.findFirst({
    where: { companyId: req.params.id, role: 'owner' },
    orderBy: { id: 'asc' },
  });
  if (!owner) {
    res.status(404).json({ error: 'У компании нет владельца' });
    return;
  }

  const clash = await prisma.user.findFirst({ where: { posPin, id: { not: owner.id } } });
  if (clash) {
    res.status(409).json({ error: PIN_TAKEN });
    return;
  }

  // Смена PIN-а — это смена доступа, и выданный раньше токен обязан перестать
  // работать: владелец, потерявший планшет, за тем сюда и пришёл.
  const admin = await prisma.adminUser.findUnique({ where: { id: req.adminUserId }, select: { name: true } });
  const actor = {
    companyId: req.params.id,
    // Намеренно null: этот человек не в списке сотрудников компании, и ссылка
    // на него сделала бы запись похожей на правку изнутри.
    actorId: null,
    actorName: `Администратор платформы${admin?.name ? ` (${admin.name})` : ''}`,
  };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: owner.id },
        data: { posPin, tokenVersion: { increment: 1 } },
      });
      await recordChanges(tx, actor, {
        entity: 'user',
        entityId: user.id,
        entityName: owner.name,
        before: owner,
        after: user,
      });
      return user;
    });
    res.json(serializeUser(updated));
  } catch (err) {
    if (!isPinConflict(err)) throw err;
    res.status(409).json({ error: PIN_TAKEN });
  }
});

companiesRouter.post('/:id/locations', async (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.type) {
    res.status(400).json({ error: 'Заполните название и тип точки' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { tariff: true, _count: { select: { locations: true } } },
  });
  if (!company) {
    res.status(404).json({ error: 'Компания не найдена' });
    return;
  }

  const refusal = limitRefusal('locations', company.tariff?.locationLimit, company._count.locations);
  if (refusal) {
    res.status(409).json({ error: refusal });
    return;
  }

  const location = await prisma.location.create({
    data: { companyId: company.id, name: b.name, type: b.type, address: b.address || null },
  });
  res.status(201).json(serializeLocation(location));
});

companiesRouter.patch('/:id/locations/:locationId', async (req, res) => {
  const b = req.body ?? {};
  const existing = await prisma.location.findFirst({ where: { id: req.params.locationId, companyId: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Точка не найдена' });
    return;
  }
  if (!b.name || !b.type) {
    res.status(400).json({ error: 'Заполните название и тип точки' });
    return;
  }

  const location = await prisma.location.update({
    where: { id: existing.id },
    data: { name: b.name, type: b.type, address: b.address || null },
  });
  res.json(serializeLocation(location));
});

companiesRouter.patch('/:id/tariff', async (req, res) => {
  const b = req.body ?? {};
  const exists = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!exists) {
    res.status(404).json({ error: 'Компания не найдена' });
    return;
  }

  const modulesRefusal = moduleListRefusal(b.modules);
  if (modulesRefusal) {
    res.status(400).json({ error: modulesRefusal });
    return;
  }

  const validUntil = readValidUntil(b.validUntil);
  if (!validUntil) {
    res.status(400).json({ error: VALID_UNTIL_REQUIRED });
    return;
  }

  await prisma.tariff.update({
    where: { companyId: req.params.id },
    data: {
      modules: JSON.stringify(b.modules ?? []),
      locationLimit: b.locationLimit ?? null,
      userLimit: b.userLimit ?? null,
      skuLimit: b.skuLimit ?? null,
      supportLevel: b.supportLevel ?? 'basic',
      validUntil,
      blocked: !!b.blocked,
      notes: b.notes ?? '',
    },
  });

  const company = await prisma.company.findUniqueOrThrow({ where: { id: req.params.id }, include });
  res.json(serializeCompany(company));
});
