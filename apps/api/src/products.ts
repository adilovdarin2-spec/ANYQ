import { prisma } from '@anyq/db';

/**
 * Не занят ли этот штрихкод другим товаром компании.
 *
 * Штрихкод — это то, чем кассир выбирает товар, и двух товаров с одним кодом
 * не бывает физически. В базе, однако, ничто этого не запрещало: два товара с
 * одним кодом заводились спокойно, а сканер после этого выбирал тот, который
 * попался первым в каталоге. Кассир подносит бутылку — пробивается другая
 * позиция, по своей цене, и остаток уходит не с той. В отчётах этого не
 * видно: обе записи выглядят правильно.
 *
 * Проверка здесь, а не ограничением в базе, по одной причине: у компании,
 * заведённой до сегодняшнего дня, такие пары уже могут быть, и миграция,
 * которая не применится, — это развёртывание, которое не поднимется.
 *
 * Отказ называет товар, у которого код уже стоит: чаще всего это тот же самый
 * товар, заведённый второй раз, и человеку нужно увидеть именно это.
 */
export async function barcodeTakenBy(companyId: string, barcode: string, exceptProductId?: string) {
  return prisma.product.findFirst({
    where: {
      companyId,
      barcode,
      ...(exceptProductId ? { id: { not: exceptProductId } } : {}),
    },
    select: { id: true, name: true },
  });
}

/** Отказ словами, либо `null`, если код свободен. */
export async function barcodeRefusal(
  companyId: string,
  barcode: string,
  exceptProductId?: string,
): Promise<string | null> {
  if (!barcode) return null;
  const taken = await barcodeTakenBy(companyId, barcode, exceptProductId);
  return taken ? `Штрихкод ${barcode} уже у товара «${taken.name}»` : null;
}
