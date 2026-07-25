import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

interface SeedCompany {
  name: string;
  phone: string;
  locations: { name: string; type: string; address: string }[];
  users: { name: string; role: string; phone: string }[];
  tariff: {
    modules: string[];
    locationLimit: number | null;
    userLimit: number | null;
    skuLimit: number | null;
    supportLevel: string;
    validUntil: string;
    blocked: boolean;
    notes: string;
  };
}

const companies: SeedCompany[] = [
  {
    name: 'Магазин «Аян»',
    phone: '+7 707 123 45 67',
    locations: [{ name: 'Магазин на Абая', type: 'shop', address: 'г. Алматы, пр. Абая 44' }],
    users: [
      { name: 'Аян Бекова', role: 'owner', phone: '+7 707 123 45 67' },
      { name: 'Дана Серикова', role: 'cashier', phone: '+7 707 555 12 34' },
    ],
    tariff: {
      modules: ['shop'],
      locationLimit: 1,
      userLimit: 3,
      skuLimit: 500,
      supportLevel: 'basic',
      validUntil: '2026-08-24',
      blocked: false,
      notes: '',
    },
  },
  {
    name: 'Склад «Северный» — Ержанов',
    phone: '+7 701 998 44 21',
    locations: [{ name: 'Склад «Северный»', type: 'warehouse', address: 'г. Астана, промзона Сарыарка' }],
    users: [
      { name: 'Ержан Тулегенов', role: 'owner', phone: '+7 701 998 44 21' },
      { name: 'Марат Оспанов', role: 'warehouse_staff', phone: '+7 701 222 33 44' },
    ],
    tariff: {
      modules: ['warehouse'],
      locationLimit: 1,
      userLimit: 5,
      skuLimit: null,
      supportLevel: 'basic',
      validUntil: '2026-08-05',
      blocked: false,
      notes: 'Первый короткий период — обсудить переход на «Бизнес» после запуска.',
    },
  },
  {
    name: 'Аптека «Денсаулық»',
    phone: '+7 705 340 90 10',
    locations: [
      { name: 'Аптека на Достык', type: 'pharmacy', address: 'г. Алматы, пр. Достык 105' },
      { name: 'Аптека на Сатпаева', type: 'pharmacy', address: 'г. Алматы, ул. Сатпаева 22' },
    ],
    users: [
      { name: 'Гульнара Ахметова', role: 'owner', phone: '+7 705 340 90 10' },
      { name: 'Айгерим Нурланова', role: 'pharmacist', phone: '+7 705 111 22 33' },
    ],
    tariff: {
      modules: ['pharmacy', 'shop'],
      locationLimit: 2,
      userLimit: 8,
      skuLimit: 2000,
      supportLevel: 'priority',
      validUntil: '2026-07-10',
      blocked: false,
      notes: 'Срок истёк — созвониться с Гульнарой насчёт продления.',
    },
  },
  {
    name: 'Сеть магазинов «Алма Маркет»',
    phone: '+7 727 250 60 60',
    locations: [
      { name: 'Алма Маркет — Бостандык', type: 'shop', address: 'г. Алматы, мкр. Самал-2' },
      { name: 'Алма Маркет — Медеу', type: 'shop', address: 'г. Алматы, ул. Кабанбай батыра' },
      { name: 'Распределительный склад', type: 'warehouse', address: 'г. Алматы, ул. Фараби 10' },
    ],
    users: [
      { name: 'Тимур Жаксыбеков', role: 'owner', phone: '+7 727 250 60 60' },
      { name: 'Асель Каримова', role: 'manager', phone: '+7 727 250 60 61' },
      { name: 'Нурлан Абдиев', role: 'warehouse_staff', phone: '+7 727 250 60 62' },
    ],
    tariff: {
      modules: ['shop', 'warehouse'],
      locationLimit: null,
      userLimit: null,
      skuLimit: null,
      supportLevel: 'dedicated',
      validUntil: '2027-07-24',
      blocked: false,
      notes: 'Ключевой клиент — персональный менеджер, офис в Астане.',
    },
  },
];

async function main() {
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'anyq2026';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.adminUser.upsert({
    where: { email: 'admin@anyq.kz' },
    update: {},
    create: { email: 'admin@anyq.kz', passwordHash, name: 'Astryx Admin' },
  });
  console.log(`Seeded admin user: admin@anyq.kz / ${process.env.ADMIN_SEED_PASSWORD ? '(из ADMIN_SEED_PASSWORD)' : adminPassword}`);

  for (const c of companies) {
    const existing = await prisma.company.findFirst({ where: { name: c.name } });
    if (existing) {
      console.log('Skip existing company', c.name);
      continue;
    }
    await prisma.company.create({
      data: {
        name: c.name,
        phone: c.phone,
        locations: { create: c.locations },
        users: { create: c.users },
        tariff: {
          create: {
            modules: JSON.stringify(c.tariff.modules),
            locationLimit: c.tariff.locationLimit,
            userLimit: c.tariff.userLimit,
            skuLimit: c.tariff.skuLimit,
            supportLevel: c.tariff.supportLevel,
            validUntil: new Date(c.tariff.validUntil),
            blocked: c.tariff.blocked,
            notes: c.tariff.notes,
          },
        },
      },
    });
    console.log('Created company', c.name);
  }

  await seedPosDemoData();
}

const posProducts = [
  { name: 'Хлеб белый', price: 250, barcode: '4870000000011', category: 'Хлеб', stock: 40 },
  { name: 'Молоко 1л', price: 590, barcode: '4870000000028', category: 'Молочка', stock: 25 },
  { name: 'Вода 0.5л', price: 150, barcode: '4870000000035', category: 'Напитки', stock: 60 },
  { name: 'Кола 0.5л', price: 350, barcode: '4870000000042', category: 'Напитки', stock: 30 },
  { name: 'Чай чёрный', price: 890, barcode: '4870000000059', category: 'Бакалея', stock: 15 },
  { name: 'Сахар 1кг', price: 520, barcode: '4870000000066', category: 'Бакалея', stock: 20 },
  { name: 'Яйца 10шт', price: 780, barcode: '4870000000073', category: 'Молочка', stock: 18 },
  { name: 'Печенье', price: 430, barcode: '4870000000080', category: 'Кондитерка', stock: 22 },
  { name: 'Сыр 200г', price: 1290, barcode: '4870000000097', category: 'Молочка', stock: 12 },
  { name: 'Йогурт', price: 340, barcode: '4870000000103', category: 'Молочка', stock: 3 },
  { name: 'Пакет', price: 20, barcode: '4870000000110', category: 'Прочее', stock: 200 },
  { name: 'Шоколад', price: 650, barcode: '4870000000127', category: 'Кондитерка', stock: 0 },
];

async function seedPosDemoData() {
  const shop = await prisma.company.findFirst({
    where: { name: 'Магазин «Аян»' },
    include: { users: true, products: true, locations: true },
  });
  if (!shop) {
    console.log('Demo shop not found, skipping POS demo data');
    return;
  }

  const cashier = shop.users.find((u) => u.role === 'cashier');
  if (cashier && !cashier.posPin) {
    await prisma.user.update({ where: { id: cashier.id }, data: { posPin: '1234' } });
    console.log(`Set POS PIN 1234 for cashier ${cashier.name}`);
  }
  const owner = shop.users.find((u) => u.role === 'owner');
  if (owner && !owner.posPin) {
    await prisma.user.update({ where: { id: owner.id }, data: { posPin: '0000' } });
    console.log(`Set POS PIN 0000 for owner ${owner.name}`);
  }

  if (shop.products.length === 0) {
    await prisma.product.createMany({
      data: posProducts.map((p) => ({
        companyId: shop.id,
        name: p.name,
        category: p.category,
        unit: 'шт',
        barcode: p.barcode,
        purchasePrice: Math.round(p.price * 0.7),
        salePrice: p.price,
      })),
    });
    console.log(`Seeded ${posProducts.length} products for Магазин «Аян»`);
  }

  const location = shop.locations[0];
  if (location) {
    const products = await prisma.product.findMany({ where: { companyId: shop.id } });
    const existingStock = await prisma.stock.findMany({ where: { locationId: location.id } });
    const stockedProductIds = new Set(existingStock.map((s) => s.productId));
    const byBarcode = new Map(posProducts.map((p) => [p.barcode, p.stock]));

    const toCreate = products
      .filter((p) => !stockedProductIds.has(p.id) && p.barcode && byBarcode.has(p.barcode))
      .map((p) => ({
        productId: p.id,
        locationId: location.id,
        quantity: byBarcode.get(p.barcode!) ?? 0,
      }));

    if (toCreate.length > 0) {
      await prisma.stock.createMany({ data: toCreate });
      console.log(`Seeded stock for ${toCreate.length} products at ${location.name}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
