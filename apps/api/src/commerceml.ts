import { KZ_OFFSET_HOURS } from './kz-time';

/**
 * Выгрузка в формате, который читает 1С.
 *
 * Формат называется CommerceML 2 — это то, чем 1С обменивается с сайтами с
 * 2005 года, и то, что понимают «Розница», «Управление торговлей» и обработка
 * «Обмен с сайтом» в «Бухгалтерии». Выбран он не из любви к XML, а потому что
 * это единственный формат, который бухгалтер может загрузить сам, без
 * программиста и без доработки конфигурации.
 *
 * Здесь две выгрузки, и это ровно те два файла, которыми обмен и начинается:
 *
 *   `import.xml`  — что за товары есть: классификатор групп и каталог;
 *   `offers.xml`  — почём и сколько: цены и остатки на дату выгрузки.
 *
 * Чего здесь нет и не обещается: документов — приёмок, продаж, возвратов.
 * Они выгружаются таблицей (CSV) и грузятся в 1С через «Загрузку из
 * табличного документа». Документы в CommerceML описываются иначе и требуют
 * сопоставления контрагентов и договоров на стороне 1С; делать это вслепую,
 * без настоящей базы, на которой можно проверить, — значит выдать за готовое
 * то, что развалится при первой загрузке.
 *
 * **Кодировка — UTF-8, и это не вкусовщина.** Классические выгрузки 1С идут в
 * windows-1251, и её было бы «роднее» отдавать. Но в cp1251 нет казахских букв
 * — ә, ғ, қ, ң, ө, ұ, ү, һ, і, — то есть каталог казахстанского магазина она
 * портит молча, по одной букве в названии. 1С читает UTF-8, когда кодировка
 * объявлена в самом файле; она объявлена.
 */

/** Версия схемы, под которую написана выгрузка. */
export const SCHEMA_VERSION = '2.08';

/**
 * Единицы измерения по ОКЕИ — те, в которых мы уверены.
 *
 * 1С хранит единицу кодом классификатора, а у нас это строка, которую владелец
 * написал руками: «шт», «мешок», «порция». Известные переводятся кодом,
 * неизвестные уходят кодом штуки, но со своим названием — чтобы бухгалтер
 * увидел в 1С то же слово, что у себя в каталоге, и поправил код, если это
 * важно для его учёта. Придумывать код — хуже: неверный код тихо превращает
 * мешок в штуку уже в самой 1С.
 */
export const OKEI: Record<string, { code: string; short: string; full: string }> = {
  'шт': { code: '796', short: 'шт', full: 'Штука' },
  'штука': { code: '796', short: 'шт', full: 'Штука' },
  'кг': { code: '166', short: 'кг', full: 'Килограмм' },
  'г': { code: '163', short: 'г', full: 'Грамм' },
  'л': { code: '112', short: 'л', full: 'Литр' },
  'мл': { code: '111', short: 'мл', full: 'Миллилитр' },
  'м': { code: '006', short: 'м', full: 'Метр' },
  'уп': { code: '778', short: 'уп', full: 'Упаковка' },
  'упаковка': { code: '778', short: 'уп', full: 'Упаковка' },
};

/** Код штуки — им уходит всё, чего нет в таблице выше. */
export const FALLBACK_UNIT_CODE = '796';

export function unitOf(unit: string): { code: string; short: string; full: string } {
  const known = OKEI[unit.trim().toLowerCase()];
  if (known) return known;
  const own = unit.trim() || 'шт';
  return { code: FALLBACK_UNIT_CODE, short: own, full: own };
}

/** Текст, который не сломает разметку. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Момент формирования так, как его записывает 1С: без буквы Z и без смещения.
 *
 * Местное время магазина, а не UTC. Выгрузка, помеченная пятью часами раньше,
 * — это выгрузка, про которую бухгалтер скажет «вчерашняя».
 */
export function commerceTimestamp(at: Date): string {
  return new Date(at.getTime() + KZ_OFFSET_HOURS * 60 * 60 * 1000).toISOString().slice(0, 19);
}

/**
 * Устойчивый идентификатор группы.
 *
 * Категория у нас — строка, а 1С сопоставляет группы по `Ид`. Поэтому он
 * считается из самого названия: одна и та же категория даёт один и тот же
 * идентификатор в каждой выгрузке, и повторная загрузка не заводит вторую
 * группу «Бакалея» рядом с первой.
 */
export function groupId(category: string): string {
  let hash = 0;
  for (const char of category.trim().toLowerCase()) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return `anyq-group-${hash.toString(16).padStart(8, '0')}`;
}

export interface CommerceProduct {
  id: string;
  name: string;
  unit: string;
  barcode: string | null;
  category: string | null;
}

export interface CommerceOffer {
  id: string;
  name: string;
  unit: string;
  /** Цена продажи за единицу, в тенге. */
  price: number;
  /** Остаток на момент выгрузки. */
  quantity: number;
}

interface Meta {
  companyId: string;
  companyName: string;
  at: Date;
}

function header(at: Date): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<КоммерческаяИнформация ВерсияСхемы="${SCHEMA_VERSION}" ДатаФормирования="${commerceTimestamp(at)}">\n`
  );
}

/** Каталог: какие товары есть и в каких группах лежат. */
export function catalogXml(meta: Meta, products: CommerceProduct[]): string {
  const categories = [...new Set(products.map((p) => p.category?.trim()).filter((c): c is string => !!c))].sort(
    (a, b) => a.localeCompare(b, 'ru'),
  );

  const groups = categories
    .map((c) => `      <Группа>\n        <Ид>${groupId(c)}</Ид>\n        <Наименование>${escapeXml(c)}</Наименование>\n      </Группа>\n`)
    .join('');

  const items = products
    .map((p) => {
      const unit = unitOf(p.unit);
      const lines = [
        `      <Товар>`,
        `        <Ид>${escapeXml(p.id)}</Ид>`,
        `        <Наименование>${escapeXml(p.name)}</Наименование>`,
        `        <БазоваяЕдиница Код="${unit.code}" НаименованиеКраткое="${escapeXml(unit.short)}" НаименованиеПолное="${escapeXml(unit.full)}"/>`,
      ];
      if (p.barcode) lines.push(`        <Штрихкод>${escapeXml(p.barcode)}</Штрихкод>`);
      if (p.category?.trim()) {
        lines.push(`        <Группы>`, `          <Ид>${groupId(p.category)}</Ид>`, `        </Группы>`);
      }
      lines.push(`      </Товар>`);
      return lines.join('\n') + '\n';
    })
    .join('');

  return (
    header(meta.at) +
    '  <Классификатор>\n' +
    `    <Ид>${escapeXml(meta.companyId)}</Ид>\n` +
    `    <Наименование>${escapeXml(meta.companyName)}</Наименование>\n` +
    (groups ? `    <Группы>\n${groups}    </Группы>\n` : '') +
    '  </Классификатор>\n' +
    '  <Каталог СодержитТолькоИзменения="false">\n' +
    `    <Ид>${escapeXml(meta.companyId)}-catalog</Ид>\n` +
    `    <ИдКлассификатора>${escapeXml(meta.companyId)}</ИдКлассификатора>\n` +
    `    <Наименование>${escapeXml(meta.companyName)}</Наименование>\n` +
    `    <Товары>\n${items}    </Товары>\n` +
    '  </Каталог>\n' +
    '</КоммерческаяИнформация>\n'
  );
}

/** Предложения: почём и сколько, на момент выгрузки. */
export function offersXml(meta: Meta, offers: CommerceOffer[]): string {
  const priceTypeId = `${meta.companyId}-price-retail`;

  const items = offers
    .map((o) => {
      const unit = unitOf(o.unit);
      return (
        `      <Предложение>\n` +
        `        <Ид>${escapeXml(o.id)}</Ид>\n` +
        `        <Наименование>${escapeXml(o.name)}</Наименование>\n` +
        `        <БазоваяЕдиница Код="${unit.code}" НаименованиеКраткое="${escapeXml(unit.short)}" НаименованиеПолное="${escapeXml(unit.full)}"/>\n` +
        `        <Цены>\n` +
        `          <Цена>\n` +
        `            <ИдТипаЦены>${priceTypeId}</ИдТипаЦены>\n` +
        `            <ЦенаЗаЕдиницу>${o.price}</ЦенаЗаЕдиницу>\n` +
        `            <Валюта>KZT</Валюта>\n` +
        `            <Единица>${escapeXml(unit.short)}</Единица>\n` +
        `            <Коэффициент>1</Коэффициент>\n` +
        `          </Цена>\n` +
        `        </Цены>\n` +
        `        <Количество>${o.quantity}</Количество>\n` +
        `      </Предложение>\n`
      );
    })
    .join('');

  return (
    header(meta.at) +
    '  <ПакетПредложений>\n' +
    `    <Ид>${escapeXml(meta.companyId)}-offers</Ид>\n` +
    `    <Наименование>${escapeXml(meta.companyName)}</Наименование>\n` +
    `    <ИдКаталога>${escapeXml(meta.companyId)}-catalog</ИдКаталога>\n` +
    `    <ИдКлассификатора>${escapeXml(meta.companyId)}</ИдКлассификатора>\n` +
    '    <ТипыЦен>\n' +
    '      <ТипЦены>\n' +
    `        <Ид>${priceTypeId}</Ид>\n` +
    '        <Наименование>Цена продажи</Наименование>\n' +
    '        <Валюта>KZT</Валюта>\n' +
    '      </ТипЦены>\n' +
    '    </ТипыЦен>\n' +
    `    <Предложения>\n${items}    </Предложения>\n` +
    '  </ПакетПредложений>\n' +
    '</КоммерческаяИнформация>\n'
  );
}
