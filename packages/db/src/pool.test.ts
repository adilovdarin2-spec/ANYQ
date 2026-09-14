import { describe, it, expect } from 'vitest';
import { POOL_SIZE, withPoolSize } from './pool';

describe('размер пула соединений', () => {
  it('дописывается к адресу, где его нет', () => {
    expect(withPoolSize('postgresql://u:p@host:5432/anyq')).toBe(
      `postgresql://u:p@host:5432/anyq?connection_limit=${POOL_SIZE}`,
    );
  });

  it('присоединяется через «&», если параметры уже есть', () => {
    expect(withPoolSize('postgresql://u:p@host:5432/anyq?schema=public')).toBe(
      `postgresql://u:p@host:5432/anyq?schema=public&connection_limit=${POOL_SIZE}`,
    );
  });

  it('не спорит с тем, что написано в адресе', () => {
    // База может быть общей, и тогда сумму пулов держат ниже max_connections
    // руками. Написанное руками важнее умолчания.
    const url = 'postgresql://u:p@host:5432/anyq?connection_limit=5';
    expect(withPoolSize(url)).toBe(url);
    expect(withPoolSize('postgresql://u:p@host:5432/anyq?connection_limit=5&schema=public')).toBe(
      'postgresql://u:p@host:5432/anyq?connection_limit=5&schema=public',
    );
  });

  it('оставляет пустой адрес пустым', () => {
    // Иначе Prisma получила бы строку «?connection_limit=20» вместо адреса и
    // пожаловалась бы на неё, а не на то, что DATABASE_URL не задан.
    expect(withPoolSize(undefined)).toBeUndefined();
    expect(withPoolSize('')).toBeUndefined();
  });

  it('берёт с запасом к самому широкому вееру запросов в коде', () => {
    // Сводка смены — десять запросов одним `Promise.all`.
    expect(POOL_SIZE).toBeGreaterThan(10);
  });
});
