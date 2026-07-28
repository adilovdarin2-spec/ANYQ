import { Router } from 'express';
import { prisma, Prisma } from '@anyq/db';
import { requireAuth } from '../auth';

export const companiesRouter = Router();
companiesRouter.use(requireAuth);

const include = { locations: true, users: true, tariff: true } satisfies Prisma.CompanyInclude;
type CompanyWithRelations = Prisma.CompanyGetPayload<{ include: typeof include }>;

function serializeCompany(company: CompanyWithRelations) {
  return {
    id: company.id,
    name: company.name,
    phone: company.phone,
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

  const company = await prisma.company.create({
    data: {
      name: b.name,
      phone: b.phone,
      locations: { create: [{ name: b.location.name, type: b.location.type, address: b.location.address ?? '' }] },
      users: { create: [{ name: b.owner.name, role: 'owner', phone: b.owner.phone ?? '' }] },
      tariff: {
        create: {
          modules: JSON.stringify(b.tariff?.modules ?? []),
          locationLimit: b.tariff?.locationLimit ?? null,
          userLimit: b.tariff?.userLimit ?? null,
          skuLimit: b.tariff?.skuLimit ?? null,
          supportLevel: b.tariff?.supportLevel ?? 'basic',
          validUntil: new Date(b.tariff?.validUntil),
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
      const sales = await prisma.document.findMany({
        where: {
          locationId: shift.locationId,
          type: 'sale',
          createdAt: { gte: shift.openedAt, ...(shift.closedAt ? { lte: shift.closedAt } : {}) },
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

  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    res.status(404).json({ error: 'Компания не найдена' });
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

const PIN_PATTERN = /^\d{4,6}$/;

// posPin is looked up globally (not scoped by company) at /pos/login, so it
// must be unique across every company on the platform, not just this one.
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

  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    res.status(404).json({ error: 'Компания не найдена' });
    return;
  }

  if (posPin) {
    const conflict = await prisma.user.findFirst({ where: { posPin } });
    if (conflict) {
      res.status(409).json({ error: 'Этот PIN уже используется другим сотрудником' });
      return;
    }
  }

  const user = await prisma.user.create({
    data: { companyId: company.id, name: b.name, role: b.role, phone: b.phone || null, posPin: posPin || null },
  });
  res.status(201).json(serializeUser(user));
});

companiesRouter.patch('/:id/users/:userId', async (req, res) => {
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
      res.status(409).json({ error: 'Этот PIN уже используется другим сотрудником' });
      return;
    }
  }

  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { name: b.name, role: b.role, phone: b.phone || null, posPin: posPin || null },
  });
  res.json(serializeUser(user));
});

companiesRouter.patch('/:id/tariff', async (req, res) => {
  const b = req.body ?? {};
  const exists = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!exists) {
    res.status(404).json({ error: 'Компания не найдена' });
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
      validUntil: new Date(b.validUntil),
      blocked: !!b.blocked,
      notes: b.notes ?? '',
    },
  });

  const company = await prisma.company.findUniqueOrThrow({ where: { id: req.params.id }, include });
  res.json(serializeCompany(company));
});
