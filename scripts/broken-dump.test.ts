import { describe, it, expect } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
// @ts-expect-error — скрипты обслуживания написаны на .mjs и типов не имеют.
import { brokenDumpMessage } from './lib/broken-dump.mjs';

/**
 * Порченую копию узнают по коду ошибки, а не по её тексту.
 *
 * Разбор шёл по трём строкам из сообщения zlib, и этого хватало ровно до того
 * дня, когда пришла четвёртая: «invalid code -- missing end-of-block». Тогда
 * человек, разворачивающий копию — а делает он это обычно не от хорошей жизни,
 * — получал внутреннюю строку zlib, в которой не сказано ни что за файл, ни что
 * делать дальше.
 *
 * Ошибки здесь настоящие: файл ломается по-разному и разворачивается
 * по-настоящему. Рукодельный объект `{ code: 'Z_DATA_ERROR' }` доказал бы, что
 * функция читает собственную выдумку, — а вопрос в том, что именно приходит из
 * zlib на битых байтах.
 */

/** Настоящая ошибка распаковки: ломаем архив и разворачиваем его. */
function realZlibError(broken: Buffer): unknown {
  try {
    gunzipSync(broken);
  } catch (err) {
    return err;
  }
  throw new Error('файл развернулся — сломать не получилось, тест доказывает не то');
}

const целый = gzipSync(Buffer.from('CREATE TABLE stock (id text);\n'.repeat(200)));

describe('битая копия', () => {
  it('узнаётся, когда байты внутри испорчены', () => {
    const битый = Buffer.from(целый);
    битый.fill(0x41, 40, 60);
    const said = brokenDumpMessage(realZlibError(битый), 'backups/anyq.sql.gz');
    expect(said, 'ошибка не опознана — человек увидит строку из zlib').toBeTruthy();
    expect(said).toContain('backups/anyq.sql.gz');
    expect(said).toContain('негодной');
  });

  it('и когда файл скачан наполовину', () => {
    const обрезанный = целый.subarray(0, Math.floor(целый.length / 2));
    const said = brokenDumpMessage(realZlibError(обрезанный), 'backups/anyq.sql.gz');
    expect(said, 'обрыв на середине — тот самый случай, ради которого всё это').toBeTruthy();
  });

  it('и когда это вообще не gzip', () => {
    const не_архив = Buffer.from('-- обычный дамп, забыли сжать\n');
    const said = brokenDumpMessage(realZlibError(не_архив), 'backups/anyq.sql');
    expect(said).toBeTruthy();
  });

  it('техническая строка остаётся для того, кто будет разбираться', () => {
    const битый = Buffer.from(целый);
    битый.fill(0x41, 40, 60);
    const err = realZlibError(битый) as { message: string };
    expect(brokenDumpMessage(err, 'f.gz')).toContain(err.message);
  });

  it('а ошибка базы порчей копии не объявляется', () => {
    /* Обратная сторона, и она важнее прямой: «нет прав», «кончилось место» и
       «такой роли нет» — это не про файл. Назвать их порчей копии значит
       отправить человека искать другую копию вместо того, чтобы чинить сервер. */
    expect(brokenDumpMessage(new Error('psql exited 1\nFATAL: role "anyq" does not exist'), 'f.gz')).toBeNull();
    expect(brokenDumpMessage(new Error('could not extend file: No space left on device'), 'f.gz')).toBeNull();
    expect(brokenDumpMessage(new Error('docker exec failed — is Docker running?'), 'f.gz')).toBeNull();
  });

  it('и на чём попало не падает', () => {
    expect(brokenDumpMessage(null, 'f.gz')).toBeNull();
    expect(brokenDumpMessage(undefined, 'f.gz')).toBeNull();
    expect(brokenDumpMessage('строка вместо ошибки', 'f.gz')).toBeNull();
  });
});
