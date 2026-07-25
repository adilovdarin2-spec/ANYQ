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
    users: company.users.map((u) => ({ id: u.id, name: u.name, role: u.role, phone: u.phone ?? '' })),
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
