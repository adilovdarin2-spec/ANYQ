import { describe, it, expect } from 'vitest';
// @ts-expect-error — скрипт копирования на .mjs, типов у него нет и не нужно.
import { canonicalQuery, encodePath, expired, parseListing, signRequest } from '../../../scripts/lib/s3.mjs';

/**
 * Подпись запросов к хранилищу копий.
 *
 * Единственное место во всём копировании, где ошибка не видна глазом: сервер
 * ответит «SignatureDoesNotMatch» и не скажет, из-за чего именно. Поэтому
 * подпись собрана чистой функцией и проверяется здесь — и отдельно проверена
 * живьём против настоящего S3-сервера (MinIO в контейнере): положить, прочитать
 * обратно побайтово, перечислить, удалить. Эталонное значение ниже взято из
 * той же реализации, что прошла живую проверку, — оно держит алгоритм от
 * случайного изменения, а не доказывает его правильность само по себе.
 *
 * Как повторить живую проверку — в docs/BACKUP_RUNBOOK.md.
 */

const КЛЮЧ = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  now: new Date('2026-09-12T08:00:00.000Z'),
};
const ПУСТО = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('подпись запроса', () => {
  const подписать = (over: Record<string, unknown> = {}) =>
    signRequest({
      method: 'PUT',
      host: 's3.example.com',
      path: '/anyq-backups/anyq/копия (1).sql.gz',
      headers: { 'content-type': 'application/octet-stream' },
      payloadSha256: ПУСТО,
      ...КЛЮЧ,
      ...over,
    });

  it('не меняется сама по себе', () => {
    expect(подписать().signature).toBe('08801040ec41486f7f3d61f87ca3209a2bcbe7695eb7e90a5cf94ac07cd070f8');
  });

  it('подписывает каждый заголовок x-amz, иначе сервер откажет', () => {
    const { canonicalRequest, authorization } = подписать();
    expect(canonicalRequest).toContain('x-amz-content-sha256:');
    expect(canonicalRequest).toContain('x-amz-date:20260912T080000Z');
    // Заголовки — по алфавиту и с тем же списком в SignedHeaders.
    expect(authorization).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date');
  });

  it('меняется от любой мелочи в запросе', () => {
    // Иначе подпись — украшение: она обязана зависеть от всего, что подписывает.
    const базовая = подписать().signature;
    expect(подписать({ method: 'GET' }).signature).not.toBe(базовая);
    expect(подписать({ path: '/anyq-backups/другой.sql.gz' }).signature).not.toBe(базовая);
    expect(подписать({ payloadSha256: 'a'.repeat(64) }).signature).not.toBe(базовая);
    expect(подписать({ secretAccessKey: 'другой-ключ' }).signature).not.toBe(базовая);
    expect(подписать({ region: 'eu-central-1' }).signature).not.toBe(базовая);
    expect(подписать({ now: new Date('2026-09-13T08:00:00.000Z') }).signature).not.toBe(базовая);
  });
});

describe('кодирование пути', () => {
  it('кодирует посегментно, косые черты оставляет', () => {
    expect(encodePath('/bucket/anyq/файл.sql.gz')).toBe('/bucket/anyq/%D1%84%D0%B0%D0%B9%D0%BB.sql.gz');
  });

  it('кодирует знаки, которые encodeURIComponent пропускает', () => {
    // S3 их кодирует, и подпись из-за одной скобки в имени не сойдётся.
    expect(encodePath("/a/b!c'd(e)f*g")).toBe('/a/b%21c%27d%28e%29f%2Ag');
  });

  it('строку запроса сортирует и кодирует', () => {
    expect(canonicalQuery({ prefix: 'anyq/', 'list-type': 2, 'max-keys': 1000 }))
      .toBe('list-type=2&max-keys=1000&prefix=anyq%2F');
  });

  it('пустые значения в запрос не попадают', () => {
    expect(canonicalQuery({ prefix: '', 'list-type': 2 })).toBe('list-type=2');
  });
});

describe('разбор ответа со списком', () => {
  const xml = `<?xml version="1.0"?><ListBucketResult>
    <Contents><Key>anyq/a.sql.gz</Key><Size>12</Size><LastModified>2026-09-11T08:00:00.000Z</LastModified></Contents>
    <Contents><Key>anyq/b &amp; c.sql.gz</Key><Size>61000</Size><LastModified>2026-09-12T08:00:00.000Z</LastModified></Contents>
    <IsTruncated>false</IsTruncated></ListBucketResult>`;

  it('читает ключи, размеры и раскодирует имена', () => {
    const { objects, truncated } = parseListing(xml);
    expect(objects).toHaveLength(2);
    expect(objects[1]).toMatchObject({ key: 'anyq/b & c.sql.gz', size: 61000 });
    expect(truncated).toBe(false);
  });

  it('замечает, что список не поместился', () => {
    const many = xml.replace('<IsTruncated>false</IsTruncated>', '<IsTruncated>true</IsTruncated><NextContinuationToken>ещё</NextContinuationToken>');
    expect(parseListing(many)).toMatchObject({ truncated: true, next: 'ещё' });
  });

  it('на пустом бакете не падает', () => {
    expect(parseListing('<ListBucketResult></ListBucketResult>').objects).toEqual([]);
  });
});

describe('какие копии удалять', () => {
  const ключи = [
    'anyq/anyq-2026-09-10.sql.gz',
    'anyq/anyq-2026-09-12.sql.gz',
    'anyq/anyq-2026-09-11.sql.gz',
  ];

  it('оставляет последние N по имени', () => {
    // Имя содержит отметку времени по построению, поэтому сортировка по имени
    // надёжнее, чем LastModified, который каждый поставщик округляет по-своему.
    expect(expired(ключи, 2)).toEqual(['anyq/anyq-2026-09-10.sql.gz']);
    expect(expired(ключи, 3)).toEqual([]);
    expect(expired(ключи, 10)).toEqual([]);
  });

  it('без срока хранения не удаляет ничего', () => {
    // Единственная необратимая операция во всём копировании. Ноль, пустое
    // значение и мусор в настройке означают «не трогать», а не «удалить всё».
    expect(expired(ключи, 0)).toEqual([]);
    expect(expired(ключи, -1)).toEqual([]);
    expect(expired(ключи, Number.NaN)).toEqual([]);
  });
});
