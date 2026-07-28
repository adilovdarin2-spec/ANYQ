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
      modules: ['shop', 'warehouse', 'retail'],
      locationLimit: null,
      userLimit: null,
      skuLimit: null,
      supportLevel: 'dedicated',
      validUntil: '2027-07-24',
      blocked: false,
      notes: 'Ключевой клиент — персональный менеджер, офис в Астане.',
    },
  },
  {
    name: 'Склад HoReCa «Дастархан Опт»',
    phone: '+7 700 450 30 20',
    locations: [{ name: 'Склад «Дастархан Опт»', type: 'supply', address: 'г. Алматы, ул. Радостовца 12' }],
    users: [
      { name: 'Бахыт Сериков', role: 'owner', phone: '+7 700 450 30 20' },
      { name: 'Айбек Нургалиев', role: 'warehouse_staff', phone: '+7 700 450 30 21' },
    ],
    tariff: {
      modules: ['supply'],
      locationLimit: 1,
      userLimit: 5,
      skuLimit: null,
      supportLevel: 'priority',
      validUntil: '2026-10-24',
      blocked: false,
      notes: 'Тариф для поставок кафе и ресторанам — заказы принимаются через публичный сайт заказов.',
    },
  },
  {
    name: 'Кафе «Тандыр»',
    phone: '+7 707 890 12 34',
    locations: [{ name: 'Кафе «Тандыр» на Достык', type: 'restaurant', address: 'г. Алматы, пр. Достык 200' }],
    users: [
      { name: 'Ерлан Сагитов', role: 'owner', phone: '+7 707 890 12 34' },
      { name: 'Жанна Токтарова', role: 'cashier', phone: '+7 707 890 12 35' },
    ],
    tariff: {
      modules: ['restaurant', 'terminal'],
      locationLimit: 1,
      userLimit: 5,
      skuLimit: null,
      supportLevel: 'basic',
      validUntil: '2026-12-31',
      blocked: false,
      notes: 'Кафе с открытой кухней — Restaurant Pack (рецептуры, food cost) + ПК/Терминал.',
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
  await seedSupplyDemoData();
  await seedPharmacyDemoData();
  await seedRestaurantDemoData();
  await seedWarehouseTransferDemoData();
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

const supplyProducts = [
  { name: 'Мука высший сорт 25кг', price: 12500, unit: 'мешок', category: 'Бакалея', stock: 40 },
  { name: 'Масло растительное 5л', price: 6200, unit: 'канистра', category: 'Бакалея', stock: 30 },
  { name: 'Рис круглозёрный 25кг', price: 15800, unit: 'мешок', category: 'Бакалея', stock: 25 },
  { name: 'Сахар песок 50кг', price: 21000, unit: 'мешок', category: 'Бакалея', stock: 18 },
  { name: 'Соль пищевая 25кг', price: 3200, unit: 'мешок', category: 'Бакалея', stock: 35 },
  { name: 'Курица тушка охл.', price: 1450, unit: 'кг', category: 'Мясо', stock: 120 },
  { name: 'Говядина котлетная', price: 3100, unit: 'кг', category: 'Мясо', stock: 60 },
  { name: 'Картофель', price: 220, unit: 'кг', category: 'Овощи', stock: 300 },
  { name: 'Лук репчатый', price: 180, unit: 'кг', category: 'Овощи', stock: 200 },
  { name: 'Помидоры', price: 650, unit: 'кг', category: 'Овощи', stock: 80 },
  { name: 'Салфетки бумажные', price: 890, unit: 'упаковка', category: 'Расходники', stock: 100 },
  { name: 'Стаканы одноразовые 200мл', price: 1450, unit: 'упаковка', category: 'Расходники', stock: 4 },
];

async function seedSupplyDemoData() {
  const supply = await prisma.company.findFirst({
    where: { name: 'Склад HoReCa «Дастархан Опт»' },
    include: { users: true, products: true, locations: true },
  });
  if (!supply) {
    console.log('Demo supply warehouse not found, skipping supply demo data');
    return;
  }

  const owner = supply.users.find((u) => u.role === 'owner');
  if (owner && !owner.posPin) {
    await prisma.user.update({ where: { id: owner.id }, data: { posPin: '5678' } });
    console.log(`Set POS PIN 5678 for owner ${owner.name}`);
  }
  const staff = supply.users.find((u) => u.role === 'warehouse_staff');
  if (staff && !staff.posPin) {
    await prisma.user.update({ where: { id: staff.id }, data: { posPin: '5679' } });
    console.log(`Set POS PIN 5679 for warehouse staff ${staff.name}`);
  }

  if (supply.products.length === 0) {
    await prisma.product.createMany({
      data: supplyProducts.map((p) => ({
        companyId: supply.id,
        name: p.name,
        category: p.category,
        unit: p.unit,
        purchasePrice: Math.round(p.price * 0.75),
        salePrice: p.price,
      })),
    });
    console.log(`Seeded ${supplyProducts.length} products for Склад HoReCa «Дастархан Опт»`);
  }

  const location = supply.locations[0];
  if (location) {
    const products = await prisma.product.findMany({ where: { companyId: supply.id } });
    const existingStock = await prisma.stock.findMany({ where: { locationId: location.id } });
    const stockedProductIds = new Set(existingStock.map((s) => s.productId));
    const byName = new Map(supplyProducts.map((p) => [p.name, p.stock]));

    const toCreate = products
      .filter((p) => !stockedProductIds.has(p.id) && byName.has(p.name))
      .map((p) => ({
        productId: p.id,
        locationId: location.id,
        quantity: byName.get(p.name) ?? 0,
      }));

    if (toCreate.length > 0) {
      await prisma.stock.createMany({ data: toCreate });
      console.log(`Seeded stock for ${toCreate.length} products at ${location.name}`);
    }
  }
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

interface SeedBatch {
  batchNumber: string;
  days: number; // relative to seed run time — negative means already expired
  quantity: number;
}

const pharmacyProducts: { name: string; price: number; unit: string; category: string; batches: SeedBatch[] }[] = [
  {
    name: 'Парацетамол 500мг №20',
    price: 450,
    unit: 'уп',
    category: 'Обезболивающие',
    batches: [
      { batchNumber: 'PCM-2601', days: 12, quantity: 15 },
      { batchNumber: 'PCM-2612', days: 220, quantity: 60 },
    ],
  },
  {
    name: 'Ибупрофен 400мг №20',
    price: 680,
    unit: 'уп',
    category: 'Обезболивающие',
    batches: [
      { batchNumber: 'IBU-2598', days: -40, quantity: 8 },
      { batchNumber: 'IBU-2650', days: 300, quantity: 40 },
    ],
  },
  {
    name: 'Аспирин 500мг №10',
    price: 320,
    unit: 'уп',
    category: 'Обезболивающие',
    batches: [{ batchNumber: 'ASP-2605', days: 200, quantity: 50 }],
  },
  {
    name: 'Но-шпа 40мг №24',
    price: 1450,
    unit: 'уп',
    category: 'Спазмолитики',
    batches: [{ batchNumber: 'NSP-2590', days: 20, quantity: 10 }],
  },
  {
    name: 'Витамин C 500мг №30',
    price: 890,
    unit: 'уп',
    category: 'Витамины',
    batches: [{ batchNumber: 'VTC-2611', days: 400, quantity: 80 }],
  },
  {
    name: 'Активированный уголь №10',
    price: 280,
    unit: 'уп',
    category: 'ЖКТ',
    batches: [{ batchNumber: 'AKT-2555', days: -5, quantity: 12 }],
  },
  { name: 'Антисептик для рук 100мл', price: 590, unit: 'шт', category: 'Гигиена', batches: [] },
  { name: 'Термометр электронный', price: 3200, unit: 'шт', category: 'Приборы', batches: [] },
  {
    name: 'Маска медицинская №50',
    price: 1200,
    unit: 'уп',
    category: 'Гигиена',
    batches: [{ batchNumber: 'MSK-2620', days: 500, quantity: 100 }],
  },
];

async function seedPharmacyDemoData() {
  const pharmacy = await prisma.company.findFirst({
    where: { name: 'Аптека «Денсаулық»' },
    include: { users: true, products: true, locations: true, tariff: true },
  });
  if (!pharmacy) {
    console.log('Demo pharmacy not found, skipping pharmacy demo data');
    return;
  }

  // The seeded tariff intentionally starts expired (to demo the admin "expired" state) —
  // extend it here so the pharmacy demo account is actually usable for testing.
  if (pharmacy.tariff && pharmacy.tariff.validUntil < new Date()) {
    await prisma.tariff.update({ where: { id: pharmacy.tariff.id }, data: { validUntil: daysFromNow(180) } });
    console.log('Extended Аптека «Денсаулық» tariff validUntil for demo purposes');
  }

  const owner = pharmacy.users.find((u) => u.role === 'owner');
  if (owner && !owner.posPin) {
    await prisma.user.update({ where: { id: owner.id }, data: { posPin: '2222' } });
    console.log(`Set POS PIN 2222 for owner ${owner.name}`);
  }
  const pharmacist = pharmacy.users.find((u) => u.role === 'pharmacist');
  if (pharmacist && !pharmacist.posPin) {
    await prisma.user.update({ where: { id: pharmacist.id }, data: { posPin: '2223' } });
    console.log(`Set POS PIN 2223 for pharmacist ${pharmacist.name}`);
  }

  if (pharmacy.products.length === 0) {
    await prisma.product.createMany({
      data: pharmacyProducts.map((p) => ({
        companyId: pharmacy.id,
        name: p.name,
        category: p.category,
        unit: p.unit,
        purchasePrice: Math.round(p.price * 0.6),
        salePrice: p.price,
      })),
    });
    console.log(`Seeded ${pharmacyProducts.length} products for Аптека «Денсаулық»`);
  }

  const location = pharmacy.locations[0];
  if (!location) return;

  const products = await prisma.product.findMany({ where: { companyId: pharmacy.id } });
  const productByName = new Map(products.map((p) => [p.name, p]));
  const existingBatches = await prisma.productBatch.findMany({ where: { locationId: location.id } });
  const existingBatchNumbers = new Set(existingBatches.map((batch) => batch.batchNumber));
  const existingStock = await prisma.stock.findMany({ where: { locationId: location.id } });
  const stockByProductId = new Map(existingStock.map((s) => [s.productId, s]));

  for (const p of pharmacyProducts) {
    const product = productByName.get(p.name);
    if (!product) continue;

    if (p.batches.length === 0) {
      if (!stockByProductId.has(product.id)) {
        await prisma.stock.create({ data: { productId: product.id, locationId: location.id, quantity: 20 } });
      }
      continue;
    }

    for (const batch of p.batches) {
      if (existingBatchNumbers.has(batch.batchNumber)) continue;
      await prisma.productBatch.create({
        data: {
          productId: product.id,
          locationId: location.id,
          batchNumber: batch.batchNumber,
          expiryDate: daysFromNow(batch.days),
          quantity: batch.quantity,
        },
      });

      const stock = stockByProductId.get(product.id);
      if (stock) {
        const updated = await prisma.stock.update({ where: { id: stock.id }, data: { quantity: stock.quantity + batch.quantity } });
        stockByProductId.set(product.id, updated);
      } else {
        const created = await prisma.stock.create({ data: { productId: product.id, locationId: location.id, quantity: batch.quantity } });
        stockByProductId.set(product.id, created);
      }
    }
  }
  console.log('Seeded pharmacy batches for Аптека «Денсаулық»');
}

const restaurantIngredients: { name: string; unit: string; price: number }[] = [
  { name: 'Тесто для пиццы', unit: 'г', price: 2 },
  { name: 'Соус томатный', unit: 'г', price: 3 },
  { name: 'Сыр моцарелла', unit: 'г', price: 8 },
  { name: 'Пепперони', unit: 'г', price: 12 },
  { name: 'Спагетти', unit: 'г', price: 2 },
  { name: 'Сливки', unit: 'мл', price: 4 },
  { name: 'Бекон', unit: 'г', price: 10 },
  { name: 'Салат айсберг', unit: 'г', price: 3 },
  { name: 'Куриное филе', unit: 'г', price: 5 },
  { name: 'Помидоры черри', unit: 'г', price: 4 },
];

interface DishSeed {
  name: string;
  price: number;
  category: string;
  ingredients: { ingredientName: string; quantity: number }[];
  modifiers?: { name: string; priceDelta: number }[];
}

const restaurantDishes: DishSeed[] = [
  {
    name: 'Пицца Маргарита',
    price: 3200,
    category: 'Пицца',
    ingredients: [
      { ingredientName: 'Тесто для пиццы', quantity: 250 },
      { ingredientName: 'Соус томатный', quantity: 80 },
      { ingredientName: 'Сыр моцарелла', quantity: 150 },
    ],
    modifiers: [
      { name: 'Двойной сыр', priceDelta: 300 },
      { name: 'Острая (перец чили)', priceDelta: 0 },
    ],
  },
  {
    name: 'Пицца Пепперони',
    price: 3600,
    category: 'Пицца',
    ingredients: [
      { ingredientName: 'Тесто для пиццы', quantity: 250 },
      { ingredientName: 'Соус томатный', quantity: 80 },
      { ingredientName: 'Сыр моцарелла', quantity: 120 },
      { ingredientName: 'Пепперони', quantity: 100 },
    ],
  },
  {
    name: 'Паста Карбонара',
    price: 2800,
    category: 'Паста',
    ingredients: [
      { ingredientName: 'Спагетти', quantity: 200 },
      { ingredientName: 'Сливки', quantity: 100 },
      { ingredientName: 'Бекон', quantity: 80 },
      { ingredientName: 'Сыр моцарелла', quantity: 30 },
    ],
  },
  {
    name: 'Салат Цезарь',
    price: 2200,
    category: 'Салаты',
    ingredients: [
      { ingredientName: 'Салат айсберг', quantity: 100 },
      { ingredientName: 'Куриное филе', quantity: 120 },
      { ingredientName: 'Помидоры черри', quantity: 50 },
      { ingredientName: 'Сыр моцарелла', quantity: 20 },
    ],
  },
];

const restaurantPlainProducts = [{ name: 'Кола 0.5л', price: 600, unit: 'шт', category: 'Напитки', stock: 50 }];

async function seedRestaurantDemoData() {
  const cafe = await prisma.company.findFirst({
    where: { name: 'Кафе «Тандыр»' },
    include: { users: true, products: true, locations: true },
  });
  if (!cafe) {
    console.log('Demo cafe not found, skipping restaurant demo data');
    return;
  }

  const owner = cafe.users.find((u) => u.role === 'owner');
  if (owner && !owner.posPin) {
    await prisma.user.update({ where: { id: owner.id }, data: { posPin: '3333' } });
    console.log(`Set POS PIN 3333 for owner ${owner.name}`);
  }
  const cashier = cafe.users.find((u) => u.role === 'cashier');
  if (cashier && !cashier.posPin) {
    await prisma.user.update({ where: { id: cashier.id }, data: { posPin: '3334' } });
    console.log(`Set POS PIN 3334 for cashier ${cashier.name}`);
  }

  const location = cafe.locations[0];
  if (!location) return;

  const existingNames = new Set(cafe.products.map((p) => p.name));

  const ingredientsToCreate = restaurantIngredients.filter((i) => !existingNames.has(i.name));
  if (ingredientsToCreate.length > 0) {
    await prisma.product.createMany({
      data: ingredientsToCreate.map((i) => ({
        companyId: cafe.id,
        name: i.name,
        category: 'Ингредиенты',
        unit: i.unit,
        purchasePrice: i.price,
        salePrice: i.price,
        sellable: false,
      })),
    });
    console.log(`Seeded ${ingredientsToCreate.length} ingredients for Кафе «Тандыр»`);
  }
  await prisma.product.updateMany({
    where: { companyId: cafe.id, name: { in: restaurantIngredients.map((i) => i.name) }, sellable: true },
    data: { sellable: false },
  });

  const dishesToCreate = restaurantDishes.filter((d) => !existingNames.has(d.name));
  if (dishesToCreate.length > 0) {
    await prisma.product.createMany({
      data: dishesToCreate.map((d) => ({
        companyId: cafe.id,
        name: d.name,
        category: d.category,
        unit: 'порция',
        purchasePrice: 0,
        salePrice: d.price,
      })),
    });
    console.log(`Seeded ${dishesToCreate.length} dishes for Кафе «Тандыр»`);
  }

  const plainToCreate = restaurantPlainProducts.filter((p) => !existingNames.has(p.name));
  if (plainToCreate.length > 0) {
    await prisma.product.createMany({
      data: plainToCreate.map((p) => ({
        companyId: cafe.id,
        name: p.name,
        category: p.category,
        unit: p.unit,
        purchasePrice: Math.round(p.price * 0.6),
        salePrice: p.price,
      })),
    });
    console.log(`Seeded ${plainToCreate.length} plain products for Кафе «Тандыр»`);
  }

  const products = await prisma.product.findMany({ where: { companyId: cafe.id } });
  const productByName = new Map(products.map((p) => [p.name, p]));

  const existingStock = await prisma.stock.findMany({ where: { locationId: location.id } });
  const stockedProductIds = new Set(existingStock.map((s) => s.productId));

  const ingredientStockToCreate = restaurantIngredients
    .map((i) => productByName.get(i.name))
    .filter((p): p is NonNullable<typeof p> => !!p && !stockedProductIds.has(p.id))
    .map((p) => ({ productId: p.id, locationId: location.id, quantity: 20000 }));
  if (ingredientStockToCreate.length > 0) {
    await prisma.stock.createMany({ data: ingredientStockToCreate });
    console.log(`Seeded prep stock for ${ingredientStockToCreate.length} ingredients`);
  }

  for (const p of restaurantPlainProducts) {
    const product = productByName.get(p.name);
    if (product && !stockedProductIds.has(product.id)) {
      await prisma.stock.create({ data: { productId: product.id, locationId: location.id, quantity: p.stock } });
    }
  }

  for (const dish of restaurantDishes) {
    const dishProduct = productByName.get(dish.name);
    if (!dishProduct) continue;

    const existingRecipe = await prisma.recipe.findUnique({ where: { productId: dishProduct.id } });
    if (!existingRecipe) {
      await prisma.recipe.create({
        data: {
          productId: dishProduct.id,
          ingredients: {
            create: dish.ingredients.map((ing) => {
              const ingredientProduct = productByName.get(ing.ingredientName);
              if (!ingredientProduct) throw new Error(`Missing ingredient product: ${ing.ingredientName}`);
              return { ingredientId: ingredientProduct.id, quantity: ing.quantity };
            }),
          },
        },
      });
      console.log(`Created recipe for ${dish.name}`);
    }

    if (dish.modifiers && dish.modifiers.length > 0) {
      const existingModifiers = await prisma.productModifier.findMany({ where: { productId: dishProduct.id } });
      if (existingModifiers.length === 0) {
        await prisma.productModifier.createMany({
          data: dish.modifiers.map((m) => ({ productId: dishProduct.id, name: m.name, priceDelta: m.priceDelta })),
        });
        console.log(`Created ${dish.modifiers.length} modifiers for ${dish.name}`);
      }
    }
  }
}

const networkProducts = [
  { name: 'Хлеб «Бородинский»', price: 280, barcode: '4870000000200', category: 'Хлеб', warehouseStock: 500, shopStock: 25 },
  { name: 'Молоко 1л «Радуга»', price: 620, barcode: '4870000000217', category: 'Молочка', warehouseStock: 500, shopStock: 20 },
  { name: 'Вода 1.5л', price: 220, barcode: '4870000000224', category: 'Напитки', warehouseStock: 800, shopStock: 40 },
  { name: 'Сахар 1кг', price: 540, barcode: '4870000000231', category: 'Бакалея', warehouseStock: 500, shopStock: 15 },
  { name: 'Масло растительное 1л', price: 890, barcode: '4870000000248', category: 'Бакалея', warehouseStock: 400, shopStock: 12 },
];

async function seedWarehouseTransferDemoData() {
  const network = await prisma.company.findFirst({
    where: { name: 'Сеть магазинов «Алма Маркет»' },
    include: { users: true, products: true, locations: true },
  });
  if (!network) {
    console.log('Demo network not found, skipping warehouse transfer demo data');
    return;
  }

  const manager = network.users.find((u) => u.role === 'manager');
  if (manager && !manager.posPin) {
    await prisma.user.update({ where: { id: manager.id }, data: { posPin: '4444' } });
    console.log(`Set POS PIN 4444 for manager ${manager.name}`);
  }
  const warehouseStaff = network.users.find((u) => u.role === 'warehouse_staff');
  if (warehouseStaff && !warehouseStaff.posPin) {
    await prisma.user.update({ where: { id: warehouseStaff.id }, data: { posPin: '4445' } });
    console.log(`Set POS PIN 4445 for warehouse staff ${warehouseStaff.name}`);
  }

  if (network.products.length === 0) {
    await prisma.product.createMany({
      data: networkProducts.map((p) => ({
        companyId: network.id,
        name: p.name,
        category: p.category,
        unit: 'шт',
        barcode: p.barcode,
        purchasePrice: Math.round(p.price * 0.65),
        salePrice: p.price,
      })),
    });
    console.log(`Seeded ${networkProducts.length} products for Сеть магазинов «Алма Маркет»`);
  }

  const products = await prisma.product.findMany({ where: { companyId: network.id } });
  const productByBarcode = new Map(networkProducts.map((p) => [p.barcode, p]));
  const warehouse = network.locations.find((l) => l.type === 'warehouse');

  for (const location of network.locations) {
    const existingStock = await prisma.stock.findMany({ where: { locationId: location.id } });
    const stockedProductIds = new Set(existingStock.map((s) => s.productId));
    const isWarehouse = location.id === warehouse?.id;

    const toCreate = products
      .filter((p) => p.barcode && productByBarcode.has(p.barcode) && !stockedProductIds.has(p.id))
      .map((p) => {
        const seed = productByBarcode.get(p.barcode!)!;
        return { productId: p.id, locationId: location.id, quantity: isWarehouse ? seed.warehouseStock : seed.shopStock };
      });

    if (toCreate.length > 0) {
      await prisma.stock.createMany({ data: toCreate });
      console.log(`Seeded stock for ${toCreate.length} products at ${location.name}`);
    }
  }
}

const variantSizes = [
  { label: 'S', barcode: '4870000000255', stock: 8 },
  { label: 'M', barcode: '4870000000262', stock: 14 },
  { label: 'L', barcode: '4870000000279', stock: 6 },
];

async function seedVariantDemoData() {
  const network = await prisma.company.findFirst({
    where: { name: 'Сеть магазинов «Алма Маркет»' },
    include: { locations: true },
  });
  if (!network) {
    console.log('Demo network not found, skipping variant demo data');
    return;
  }

  const existing = await prisma.product.findFirst({ where: { companyId: network.id, name: 'Футболка базовая' } });
  if (existing) {
    console.log('Variant demo product already seeded, skipping');
    return;
  }

  const location = network.locations.find((l) => l.name.includes('Бостандык'));
  if (!location) {
    console.log('Бостандык location not found, skipping variant demo data');
    return;
  }

  const parent = await prisma.product.create({
    data: {
      companyId: network.id,
      name: 'Футболка базовая',
      category: 'Одежда',
      unit: 'шт',
      purchasePrice: 2500,
      salePrice: 4900,
    },
  });

  for (const size of variantSizes) {
    const variant = await prisma.product.create({
      data: {
        companyId: network.id,
        name: `Футболка базовая — ${size.label}`,
        category: 'Одежда',
        unit: 'шт',
        barcode: size.barcode,
        purchasePrice: 2500,
        salePrice: 4900,
        parentProductId: parent.id,
        variantLabel: size.label,
      },
    });
    await prisma.stock.create({ data: { productId: variant.id, locationId: location.id, quantity: size.stock } });
  }
  console.log(`Seeded variant product "Футболка базовая" with ${variantSizes.length} sizes at ${location.name}`);
}

main()
  .then(() => seedVariantDemoData())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
