import { prisma } from '@anyq/db';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Кабинет владельца — вход по своей ссылке и своему паролю.
 *
 * Отдельная поверхность, потому что владелец не заходит в кассу. Касса стоит на
 * прилавке, её открывают PIN-кодом из четырёх цифр, который кассир видит каждый
 * день, и она принадлежит смене, а не человеку. Владельцу нужно посмотреть
 * магазин из машины с телефона, ничего не устанавливая и никого не отвлекая.
 *
 * Три решения, которые определяют всё остальное:
 *
 *   1. **Ссылка секретная, но защищает не она.** Длинный неугадываемый сегмент
 *      уменьшает вероятность случайной находки и попадания в чужие логи — и
 *      только. Защищает пароль и ограничение попыток. Поэтому ссылка одна вещь,
 *      а пароль обязателен и отдельная.
 *   2. **Пароль задаёт владелец, при первом заходе.** Мы его не придумываем и
 *      не отправляем: пароль, отправленный в WhatsApp, живёт в переписке вечно.
 *      До того как пароль задан, по ссылке не видно ничего, кроме названия
 *      компании — иначе первый, кто нашёл ссылку, увидел бы выручку.
 *   3. **Кабинет только читает.** Ни одной операции записи. Даже полностью
 *      скомпрометированный кабинет не может провести продажу, поменять цену или
 *      списать товар — худшее, что случится, это чужой человек увидит цифры.
 *      Для поверхности, открытой в интернет ради денежных данных, это разница
 *      между неприятностью и катастрофой.
 */

/**
 * Алфавит секретного сегмента ссылки.
 *
 * Без 0/O и 1/l/I: ссылку диктуют по телефону и переписывают с экрана, и пара,
 * которую невозможно различить, превращается в звонок «не открывается».
 */
const LINK_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Длина секрета.
 *
 * 26 знаков этого алфавита — примерно 128 бит. Перебирать такое по сети
 * бессмысленно: дело не в вычислениях, а в том, что каждая попытка это запрос к
 * нам, и их считают.
 */
const SECRET_LENGTH = 26;

export function newCabinetSecret(): string {
  // Отбрасываем байты, не попадающие в целое число длин алфавита, вместо
  // остатка от деления: остаток даёт первым буквам алфавита лишний вес, и
  // сколько-то бит энтропии уходит впустую.
  const limit = Math.floor(256 / LINK_ALPHABET.length) * LINK_ALPHABET.length;
  let out = '';
  while (out.length < SECRET_LENGTH) {
    for (const byte of randomBytes(SECRET_LENGTH)) {
      if (byte >= limit) continue;
      out += LINK_ALPHABET[byte % LINK_ALPHABET.length];
      if (out.length === SECRET_LENGTH) break;
    }
  }
  return out;
}

/** Похоже ли это вообще на наш секрет — до того как идти в базу. */
export function looksLikeCabinetSecret(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== SECRET_LENGTH) return false;
  for (const ch of value) if (!LINK_ALPHABET.includes(ch)) return false;
  return true;
}

export const MIN_CABINET_PASSWORD = 10;

/**
 * Пароли, которые ставят, когда просят придумать пароль.
 *
 * Список короткий намеренно: длинный превратился бы в проверку орфографии, а
 * задача другая — остановить ровно те четыре варианта, которые вводит человек,
 * желающий поскорее закрыть окно.
 */
const REFUSED = new Set([
  'password', 'парольпароль', '1234567890', '12345678901', '123456789012',
  'qwertyuiop', 'йцукенгшщз', 'anyq2026', 'anyqanyq', 'magazinmagazin',
]);

export type PasswordVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Годится ли пароль для двери, открытой в интернет.
 *
 * Правил три, и каждое отвечает на конкретный способ подобрать: длина — на
 * перебор, запрет одних цифр — на дату рождения и номер телефона, список — на
 * первое, что приходит в голову. Требования вида «заглавная и спецсимвол» здесь
 * нет намеренно: оно даёт «Магазин1!» и ощущение безопасности вместо неё.
 */
export function checkCabinetPassword(password: unknown, companyPhone?: string): PasswordVerdict {
  if (typeof password !== 'string') {
    return { ok: false, reason: 'Пароль не передан' };
  }
  if (password.length < MIN_CABINET_PASSWORD) {
    return { ok: false, reason: `Пароль короче ${MIN_CABINET_PASSWORD} знаков — по этой ссылке видна выручка` };
  }
  if (password.length > 200) {
    return { ok: false, reason: 'Слишком длинный пароль' };
  }
  if (/^\d+$/.test(password)) {
    return { ok: false, reason: 'Только цифры — это дата или номер телефона, их подбирают первыми' };
  }
  if (REFUSED.has(password.toLowerCase())) {
    return { ok: false, reason: 'Такой пароль стоит у каждого второго — придумайте свой' };
  }
  // Только когда в пароле нет ни одной буквы. Иначе «сауда 77784175136 базар»
  // попало бы под это правило: цифры в нём те же, а пароль совсем другой —
  // и человек, придумавший нормальный пароль, получил бы отказ без причины.
  if (companyPhone && !/\p{L}/u.test(password)) {
    const digits = companyPhone.replace(/\D/g, '');
    if (digits.length >= 6 && password.replace(/\D/g, '') === digits) {
      return { ok: false, reason: 'Это номер телефона компании — он есть у всех, кому вы его давали' };
    }
  }
  return { ok: true };
}

/**
 * Сравнение секретов из ссылки за постоянное время.
 *
 * Обычное `===` на строках выходит на первом несовпавшем знаке, и по времени
 * ответа секрет добирается по букве. Здесь это скорее осторожность, чем дыра —
 * сеть шумит сильнее, чем длится такое сравнение, — но привычка сравнивать
 * секреты так стоит ноль.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Ссылка, которую владелец получает на руки.
 *
 * Живёт в витрине заказов (`apps/orders`), а не отдельным приложением: это
 * пятая служба на платформе, пятая сборка и пятый адрес ради одного экрана.
 * Витрина уже смотрит в интернет и уже раздаёт страницы по секретному пути.
 */
export function cabinetLink(baseUrl: string, secret: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/k/${secret}`;
}

/**
 * Кабинет компании, создаваемый при первом обращении.
 *
 * Лениво, а не на создании компании: компаний уже заведено сколько-то, и
 * миграция, раздающая всем секретные ссылки заранее, создала бы двери, о
 * которых никто не просил.
 */
export async function ensureCabinet(companyId: string) {
  const existing = await prisma.ownerCabinet.findUnique({ where: { companyId } });
  if (existing) return existing;
  return prisma.ownerCabinet.create({ data: { companyId, secret: newCabinetSecret() } });
}

/**
 * Новая ссылка и снятый пароль — ответ на «ссылка ушла не туда».
 *
 * Меняются оба сразу и поднимается tokenVersion: оставить старый пароль на
 * новой ссылке значит не закрыть ничего, если утёк как раз он.
 */
export async function resetCabinet(companyId: string) {
  await ensureCabinet(companyId);
  return prisma.ownerCabinet.update({
    where: { companyId },
    data: {
      secret: newCabinetSecret(),
      passwordHash: null,
      passwordSetAt: null,
      lastLoginAt: null,
      tokenVersion: { increment: 1 },
    },
  });
}
