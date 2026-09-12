import { Router } from 'express';
import { prisma, Prisma } from '@anyq/db';
import { limitRefusal } from '../limits';
import { phoneKey } from '../phone';
import { requireAuth } from '../auth';
import type { AuthedRequest } from '../auth';
import { recordChanges } from '../audit-log';

export const companiesRouter = Router();
companiesRouter.use(requireAuth);

const include = { locations: true, users: true, tariff: true } satisfies Prisma.CompanyInclude;
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

function serializeCompany(company: CompanyWithRelations) {
  return {
    id: company.id,
    name: company.name,
    phone: company.phone,
    slug: company.slug,
    createdAt: company.createdAt.toISOString().slice(0, 10),
    locations: company.locations.map((l) => ({ id: l.id, name: l.name, type: l.type, address: l.address ?? '' })),
    users: company.users.map((u) => ({ id: u.id, name: u.name, role: u.role, phone: u.phone ?? '', posPin: u.posPin ?? '' })),
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

companiesRouter.get('/:id/shifts', async (req, res) => {
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
        include: { items: true },
      });

      let total = 0;
      const totalsByMethod: Record<string, number> = {};
      for (const sale of sales) {
        const saleTotal = sale.items.reduce((sum, it) => sum + it.price * it.quantity, 0);
        total += saleTotal;
        const method = sale.paymentMethod ?? 'unknown';
        totalsByMethod[method] = (totalsByMethod[method] ?? 0) + saleTotal;
      }

      return {
        id: shift.id,
        cashierName: shift.cashierName,
        openedAt: shift.openedAt.toISOString(),
        openingCash: shift.openingCash,
        closedAt: shift.closedAt ? shift.closedAt.toISOString() : null,
        closingCashCounted: shift.closingCashCounted,
        salesCount: sales.length,
        totalSales: total,
        totalsByMethod,
      };
    }),
  );

  res.json(result);
});

function serializeProduct(p: {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  barcode: string | null;
  purchasePrice: number;
  salePrice: number;
  sellable: boolean;
  stopListed: boolean;
}) {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? '',
    unit: p.unit,
    barcode: p.barcode ?? '',
    purchasePrice: p.purchasePrice,
    salePrice: p.salePrice,
    sellable: p.sellable,
    stopListed: p.stopListed,
  };
}

// Variant children (parentProductId set) are managed alongside their parent
// product's own catalog entry today, not here — this list is the top-level
// catalog only.
companiesRouter.get('/:id/products', async (req, res) => {
  const products = await prisma.product.findMany({
    where: { companyId: req.params.id, parentProductId: null },
    orderBy: { name: 'asc' },
  });
  res.json(products.map(serializeProduct));
});

companiesRouter.post('/:id/products', async (req, res) => {
  const b = req.body ?? {};
  const purchasePrice = Number(b.purchasePrice);
  const salePrice = Number(b.salePrice);
  if (!b.name || !b.unit || !Number.isFinite(purchasePrice) || !Number.isFinite(salePrice) || purchasePrice < 0 || salePrice < 0) {
    res.status(400).json({ error: 'Заполните название, единицу измерения и цены' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { tariff: true, _count: { select: { products: true } } },
  });
  if (!company) {
    res.status(404).json({ error: 'Компания не найдена' });
    return;
  }

  const refusal = limitRefusal('products', company.tariff?.skuLimit, company._count.products);
  if (refusal) {
    res.status(409).json({ error: refusal });
    return;
  }

  const product = await prisma.product.create({
    data: {
      companyId: company.id,
      name: b.name,
      category: b.category || null,
      unit: b.unit,
      barcode: b.barcode || null,
      purchasePrice,
      salePrice,
      sellable: b.sellable !== false,
    },
  });
  res.status(201).json(serializeProduct(product));
});

companiesRouter.patch('/:id/products/:productId', async (req, res) => {
  const b = req.body ?? {};
  const existing = await prisma.product.findFirst({ where: { id: req.params.productId, companyId: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Товар не найден' });
    return;
  }

  const purchasePrice = Number(b.purchasePrice);
  const salePrice = Number(b.salePrice);
  if (!b.name || !b.unit || !Number.isFinite(purchasePrice) || !Number.isFinite(salePrice) || purchasePrice < 0 || salePrice < 0) {
    res.status(400).json({ error: 'Заполните название, единицу измерения и цены' });
    return;
  }

  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      name: b.name,
      category: b.category || null,
      unit: b.unit,
      barcode: b.barcode || null,
      purchasePrice,
      salePrice,
      sellable: !!b.sellable,
    },
  });
  res.json(serializeProduct(product));
});

function serializeUser(u: { id: string; name: string; role: string; phone: string | null; posPin: string | null }) {
  return { id: u.id, name: u.name, role: u.role, phone: u.phone ?? '', posPin: u.posPin ?? '' };
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
companiesRouter.post('/:id/users', async (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.role) {
    res.status(400).json({ error: 'Заполните имя и роль' });
    return;
  }

  const posPin = typeof b.posPin === 'string' ? b.posPin.trim() : '';
  if (posPin && !PIN_PATTERN.test(posPin)) {
    res.status(400).json({ error: 'PIN должен быть числом из 4–6 цифр' });
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { tariff: true, _count: { select: { users: true } } },
  });
  if (!company) {
    res.status(404).json({ error: 'Компания не найдена' });
    return;
  }

  const refusal = limitRefusal('users', company.tariff?.userLimit, company._count.users);
  if (refusal) {
    res.status(409).json({ error: refusal });
    return;
  }

  if (posPin) {
    const conflict = await prisma.user.findFirst({ where: { posPin } });
    if (conflict) {
      res.status(409).json({ error: PIN_TAKEN });
      return;
    }
  }

  try {
    const user = await prisma.user.create({
      data: { companyId: company.id, name: b.name, role: b.role, phone: phoneKey(b.phone) || null, posPin: posPin || null },
    });
    res.status(201).json(serializeUser(user));
  } catch (err) {
    if (!isPinConflict(err)) throw err;
    // The other admin got there between the check and the insert.
    res.status(409).json({ error: PIN_TAKEN });
  }
});

companiesRouter.patch('/:id/users/:userId', async (req: AuthedRequest, res) => {
  const b = req.body ?? {};
  const existing = await prisma.user.findFirst({ where: { id: req.params.userId, companyId: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Сотрудник не найден' });
    return;
  }
  if (!b.name || !b.role) {
    res.status(400).json({ error: 'Заполните имя и роль' });
    return;
  }

  const posPin = typeof b.posPin === 'string' ? b.posPin.trim() : '';
  if (posPin && !PIN_PATTERN.test(posPin)) {
    res.status(400).json({ error: 'PIN должен быть числом из 4–6 цифр' });
    return;
  }
  if (posPin && posPin !== existing.posPin) {
    const conflict = await prisma.user.findFirst({ where: { posPin, id: { not: existing.id } } });
    if (conflict) {
      res.status(409).json({ error: PIN_TAKEN });
      return;
    }
  }

  // A new PIN or a new role is exactly the moment an old token should stop
  // working: an owner who takes a cashier's PIN away means them to be out, not
  // to keep selling from the token already on their phone for another month.
  // Renaming somebody or fixing their phone number is not that, so it doesn't
  // sign them out mid-shift.
  const accessChanged = b.role !== existing.role || (posPin || null) !== existing.posPin;

  // Named as what it is rather than by a name the owner would not recognise.
  // A role changed from outside the company is a different fact from one their
  // own manager changed, and that distinction is the point of the entry.
  const admin = await prisma.adminUser.findUnique({ where: { id: req.adminUserId }, select: { name: true } });
  const actor = {
    companyId: req.params.id,
    // Deliberately null: this person is not in the company's own user list, and
    // pointing the column at them would make the log look like an inside change.
    actorId: null,
    actorName: `Администратор платформы${admin?.name ? ` (${admin.name})` : ''}`,
  };

  try {
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: {
          name: b.name,
          role: b.role,
          phone: phoneKey(b.phone) || null,
          posPin: posPin || null,
          ...(accessChanged ? { tokenVersion: { increment: 1 } } : {}),
        },
      });
      await recordChanges(tx, actor, {
        entity: 'user',
        entityId: updated.id,
        entityName: existing.name,
        before: existing,
        after: updated,
      });
      return updated;
    });
    res.json(serializeUser(user));
  } catch (err) {
    if (!isPinConflict(err)) throw err;
    // Somebody else took the PIN between the check above and this write. The
    // transaction rolled back, so no audit entry was left for a change that
    // did not happen.
    res.status(409).json({ error: PIN_TAKEN });
  }
});

function serializeLocation(l: { id: string; name: string; type: string; address: string | null }) {
  return { id: l.id, name: l.name, type: l.type, address: l.address ?? '' };
}

// No delete route — Location is referenced by Stock/Document/Shift/ProductBatch
// FKs with no cascade, so Postgres would reject it anyway once any activity
// has happened at that location. Matches the no-delete precedent for products/users.
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
