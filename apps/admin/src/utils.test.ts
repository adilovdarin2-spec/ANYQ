import { describe, it, expect } from 'vitest';
import {
  LEGACY_MODULES,
  LOCATION_TYPE_LABELS,
  MODULE_LABELS,
  OFFERABLE_LOCATION_TYPES,
  OFFERABLE_MODULES,
  lockedModules,
  withRequiredModules,
} from './types';
import {
  pluralizeRu,
  toLocalISODate,
  parseLocalISODate,
  formatDate,
  formatDateTime,
  formatMoney,
  getTariffState,
  daysUntil,
  newValidUntil,
  extendValidUntil,
  sortForRenewal,
  countForRenewal
} from './utils';
import type { Tariff, ModuleKey } from './types';

function makeTariff(overrides: Partial<Tariff> = {}): Tariff {
  return {
    modules: ['shop'],
    locationLimit: null,
    userLimit: null,
    skuLimit: null,
    supportLevel: 'basic',
    validUntil: '2099-01-01',
    blocked: false,
    notes: '',
    ...overrides,
  };
}

describe('pluralizeRu', () => {
  it('picks "one" for 1, 21, 31...', () => {
    expect(pluralizeRu(1, 'компания', 'компании', 'компаний')).toBe('компания');
    expect(pluralizeRu(21, 'компания', 'компании', 'компаний')).toBe('компания');
  });

  it('picks "few" for 2-4, 22-24...', () => {
    expect(pluralizeRu(2, 'компания', 'компании', 'компаний')).toBe('компании');
    expect(pluralizeRu(4, 'компания', 'компании', 'компаний')).toBe('компании');
    expect(pluralizeRu(22, 'компания', 'компании', 'компаний')).toBe('компании');
  });

  it('picks "many" for 0, 5-20, 25...', () => {
    expect(pluralizeRu(0, 'компания', 'компании', 'компаний')).toBe('компаний');
    expect(pluralizeRu(5, 'компания', 'компании', 'компаний')).toBe('компаний');
    expect(pluralizeRu(11, 'компания', 'компании', 'компаний')).toBe('компаний');
    expect(pluralizeRu(25, 'компания', 'компании', 'компаний')).toBe('компаний');
  });
});

describe('toLocalISODate / parseLocalISODate', () => {
  it('round-trips a local date without timezone drift', () => {
    const d = new Date(2026, 6, 24); // July 24 2026, local midnight
    expect(toLocalISODate(d)).toBe('2026-07-24');

    const parsed = parseLocalISODate('2026-07-24');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(24);
  });
});

describe('formatDate / formatDateTime / formatMoney', () => {
  it('formats a date as DD.MM.YYYY', () => {
    expect(formatDate('2026-08-24')).toBe('24.08.2026');
  });

  it('returns an em dash for a null date', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('formats a datetime including the year', () => {
    expect(formatDateTime('2026-08-24T14:30:00.000Z')).toContain('2026');
  });

  it('formats money with the tenge symbol', () => {
    const result = formatMoney(1500);
    expect(result.endsWith('₸')).toBe(true);
    expect(result.replace(/\s/g, '')).toBe('1500₸');
  });
});

describe('getTariffState', () => {
  it('is blocked when the blocked flag is set, regardless of date', () => {
    expect(getTariffState(makeTariff({ blocked: true, validUntil: '2099-01-01' }))).toBe('blocked');
  });

  it('is expired when validUntil is in the past and not blocked', () => {
    expect(getTariffState(makeTariff({ blocked: false, validUntil: '2000-01-01' }))).toBe('expired');
  });

  it('is active when validUntil is in the future and not blocked', () => {
    expect(getTariffState(makeTariff({ blocked: false, validUntil: '2099-01-01' }))).toBe('active');
  });
});

describe('newValidUntil / extendValidUntil', () => {
  it('extends from today when the tariff is already expired, not from the stale past date', () => {
    const today = toLocalISODate(new Date());
    const extended = extendValidUntil('2000-01-01', '1m');
    expect(extended > today).toBe(true);
  });

  it('stacks the extension on top of the current validUntil when still active', () => {
    const future = newValidUntil('1y');
    const extended = extendValidUntil(future, '1m');
    expect(parseLocalISODate(extended).getTime()).toBeGreaterThan(parseLocalISODate(future).getTime());
  });
});

describe('daysUntil', () => {
  /**
   * Считается для того, чтобы счёт выставили вовремя, поэтому проверяется
   * граница, а не «через год». Дата тарифа — целый день: пока он не кончился,
   * магазин работает.
   */
  const at = (iso: string) => new Date(`${iso}T12:00:00`);

  it('сегодня последний день — ноль', () => {
    expect(daysUntil('2026-09-30', at('2026-09-30'))).toBe(0);
  });

  it('завтра — один', () => {
    expect(daysUntil('2026-09-30', at('2026-09-29'))).toBe(1);
  });

  it('неделя — семь', () => {
    expect(daysUntil('2026-09-30', at('2026-09-23'))).toBe(7);
  });

  it('кончился — отрицательное, а не ноль', () => {
    // Ноль означает «ещё сегодня работает», и спутать это с «уже не работает»
    // значит не позвонить тому, кто как раз закрыт.
    expect(daysUntil('2026-09-30', at('2026-10-01'))).toBe(-1);
  });

  it('через месяц — месяц, а не «скоро»', () => {
    expect(daysUntil('2026-10-30', at('2026-09-30'))).toBe(30);
  });
});

describe('модули, которые продаём', () => {
  // «Магазин» (`shop`) не проверяется нигде: ни в кассе, ни на сервере. А
  // галочка стояла по умолчанию у каждой новой компании — магазин, заведённый
  // по умолчанию, получал кассу без скидок, без лояльности и без весового
  // товара, и в карточке при этом было написано «Магазин».
  it('не предлагают того, что ничего не включает', () => {
    expect(OFFERABLE_MODULES).not.toContain('shop');
    expect(OFFERABLE_MODULES).toContain('retail');
  });

  it('но снять его у заведённой компании можно', () => {
    // Иначе модуль, который когда-то поставили, останется навсегда.
    expect(LEGACY_MODULES).toContain('shop');
  });

  it('у каждого предлагаемого модуля есть подпись', () => {
    for (const m of OFFERABLE_MODULES) {
      expect(MODULE_LABELS[m], m).toBeTruthy();
    }
  });

  it('подпись модуля называет, что он включает', () => {
    // «Аптека» стояла голой и обещала рецептурный учёт и маркировку, которых
    // нет: модуль даёт партии со сроками и списание по FEFO. Название, которое
    // обещает больше, чем модуль делает, — это не название, а будущий спор.
    expect(MODULE_LABELS.pharmacy).toContain('срок');
    expect(MODULE_LABELS.pharmacy).not.toBe('Аптека');
    expect(MODULE_LABELS.stock).toContain('риёмка');
    expect(MODULE_LABELS.warehouse).toContain('ячейки');
  });
});

describe('типы точек и модули — разные словари', () => {
  // До 15.09.2026 таблица была одна на двоих, и в списке «тип точки» — там,
  // где выбирают, магазин это или склад, — стояло «Магазин (ничего не
  // включает — см. «Розница»)». Подпись, верная для модуля, оказывалась
  // бессмыслицей для помещения.
  it('у каждого предлагаемого типа точки есть своя подпись', () => {
    for (const t of OFFERABLE_LOCATION_TYPES) {
      expect(LOCATION_TYPE_LABELS[t], t).toBeTruthy();
    }
  });

  it('точка называется тем, чем она является', () => {
    expect(LOCATION_TYPE_LABELS.shop).toBe('Магазин');
    expect(LOCATION_TYPE_LABELS.pharmacy).toBe('Аптека');
  });

  it('и это не те же строки, что у модулей', () => {
    const overlapping = OFFERABLE_LOCATION_TYPES.filter((t) => t in MODULE_LABELS);
    expect(overlapping.length).toBeGreaterThan(0);
    for (const t of overlapping) {
      expect(LOCATION_TYPE_LABELS[t], t).not.toBe(MODULE_LABELS[t as keyof typeof MODULE_LABELS]);
    }
  });
});

describe('зависимости модулей', () => {
  // Склад без учёта прихода — это ячейки, в которые нечего класть: приёмка и
  // инвентаризация живут в `stock`. Сервер такой набор не примет, поэтому
  // форма не даёт его собрать.
  it('склад приводит за собой учёт прихода', () => {
    expect(withRequiredModules(['warehouse'])).toContain('stock');
  });

  it('не дублирует уже выбранное', () => {
    expect(withRequiredModules(['stock', 'warehouse']).filter((m) => m === 'stock')).toHaveLength(1);
  });

  it('ничего не добавляет тому, у кого зависимостей нет', () => {
    expect(withRequiredModules(['retail'])).toEqual(['retail']);
    expect(withRequiredModules([])).toEqual([]);
  });

  it('учёт прихода нельзя снять, пока выбран склад', () => {
    expect(lockedModules(['stock', 'warehouse'])).toContain('stock');
  });

  it('а без склада — можно', () => {
    expect(lockedModules(['retail', 'stock'])).toEqual([]);
  });

  // Аптека без учёта прихода хуже склада без него: она сама создаёт то, что
  // убрать умеет только `stock`. Просроченную партию касса продать не даст, а
  // списать её на таком тарифе нечем — списание, инвентаризация, карантин и
  // возврат поставщику все за `stock`.
  it('аптека приводит за собой учёт прихода', () => {
    expect(withRequiredModules(['pharmacy'])).toContain('stock');
  });

  it('учёт прихода нельзя снять, пока выбрана аптека', () => {
    expect(lockedModules(['retail', 'stock', 'pharmacy'])).toContain('stock');
  });
});

describe('порядок списка под продление', () => {
  const NOW = new Date('2026-09-15T10:00:00');

  const company = (name: string, validUntil: string, blocked = false) => ({
    name,
    tariff: {
      modules: [] as ModuleKey[],
      locationLimit: 1,
      userLimit: 1,
      skuLimit: 1,
      supportLevel: 'basic' as const,
      validUntil,
      blocked,
      notes: '',
    },
  });

  it('истёкшие идут первыми — магазин не работает прямо сейчас', () => {
    const out = sortForRenewal(
      [company('Работает', '2026-12-01'), company('Лежит', '2026-09-01')],
      NOW,
    );
    expect(out.map((c) => c.name)).toEqual(['Лежит', 'Работает']);
  });

  it('и чем дольше лежит, тем выше', () => {
    const out = sortForRenewal(
      [company('Вчера', '2026-09-14'), company('Месяц назад', '2026-08-15')],
      NOW,
    );
    expect(out.map((c) => c.name)).toEqual(['Месяц назад', 'Вчера']);
  });

  it('среди действующих первым тот, у кого срок ближе', () => {
    const out = sortForRenewal(
      [company('Через год', '2027-09-15'), company('Послезавтра', '2026-09-17'), company('Через месяц', '2026-10-15')],
      NOW,
    );
    expect(out.map((c) => c.name)).toEqual(['Послезавтра', 'Через месяц', 'Через год']);
  });

  it('заблокированные — последними, даже если срок у них давно вышел', () => {
    // Это не «забыли», а решение, которое уже приняли: они ждут звонка, а не
    // действия. Держать их сверху значит каждый месяц пролистывать мимо.
    const out = sortForRenewal(
      [company('Заморожен', '2026-01-01', true), company('Просто истёк', '2026-09-14')],
      NOW,
    );
    expect(out.map((c) => c.name)).toEqual(['Просто истёк', 'Заморожен']);
  });

  it('при равных датах — по названию, чтобы порядок не прыгал', () => {
    // Иначе список меняется между обновлениями страницы, и глаз теряет место.
    const out = sortForRenewal(
      [company('Ящик', '2026-10-01'), company('Абрикос', '2026-10-01')],
      NOW,
    );
    expect(out.map((c) => c.name)).toEqual(['Абрикос', 'Ящик']);
  });

  it('не переставляет исходный массив', () => {
    const input = [company('Второй', '2026-09-01'), company('Первый', '2026-12-01')];
    sortForRenewal(input, NOW);
    expect(input[0].name).toBe('Второй');
  });

  it('пустой список — пустой ответ', () => {
    expect(sortForRenewal([], NOW)).toEqual([]);
  });
});

describe('счёт работы на сегодня', () => {
  const NOW = new Date('2026-09-15T10:00:00');

  const company = (validUntil: string, blocked = false) => ({
    tariff: {
      modules: [] as ModuleKey[],
      locationLimit: 1,
      userLimit: 1,
      skuLimit: 1,
      supportLevel: 'basic' as const,
      validUntil,
      blocked,
      notes: '',
    },
  });

  it('считает истёкших, скорых и замороженных по отдельности', () => {
    const counts = countForRenewal(
      [
        company('2026-09-01'),
        company('2026-09-14'),
        company('2026-09-17'),
        company('2027-01-01'),
        company('2026-01-01', true),
      ],
      NOW,
    );
    expect(counts).toEqual({ expired: 2, soon: 1, blocked: 1 });
  });

  it('замороженный не попадает ни в истёкших, ни в скорых', () => {
    // Иначе одна компания считалась бы дважды, и число сверху спорило бы с
    // порядком списка.
    expect(countForRenewal([company('2026-01-01', true)], NOW)).toEqual({ expired: 0, soon: 0, blocked: 1 });
  });

  it('сегодняшний последний день — это «скоро», а не «истёк»', () => {
    // Тариф работает весь день, за который заплачено.
    expect(countForRenewal([company('2026-09-15')], NOW)).toEqual({ expired: 0, soon: 1, blocked: 0 });
  });

  it('и считает по переданному дню, а не по системным часам', () => {
    // Проверка, которой не было, и из-за этого предыдущая держалась на
    // настоящей дате запуска: `getTariffState` читала часы сама, а
    // `countForRenewal` уже принимала `now` и пользовалась им во второй
    // половине счёта. Совпадали они ровно один день — 15.09.2026, — и 16-го
    // тест покраснел.
    //
    // Даты здесь заведомо не сегодняшние в обе стороны: пройти случайно
    // нельзя ни в какой день.
    const tariff = [company('2026-09-15')];
    expect(countForRenewal(tariff, new Date('2030-01-01T10:00:00'))).toEqual({ expired: 1, soon: 0, blocked: 0 });
    expect(countForRenewal(tariff, new Date('2020-01-01T10:00:00'))).toEqual({ expired: 0, soon: 0, blocked: 0 });
  });

  it('ровно на границе недели — ещё «скоро»', () => {
    expect(countForRenewal([company('2026-09-22')], NOW).soon).toBe(1);
    expect(countForRenewal([company('2026-09-23')], NOW).soon).toBe(0);
  });
});
