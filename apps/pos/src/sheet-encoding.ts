/**
 * Как прочитать файл, выгруженный из чужой программы.
 *
 * Касса читала такие файлы как UTF-8 и полагалась на то, что испорченный
 * текст видно в предпросмотре. Видно его и правда сразу — «Ð’Ð¾Ð´Ð° 1 Ð»» —
 * только сделать с этим владельцу магазина нечего: файл ему выгрузила
 * программа, в которой он не менял ни одной настройки.
 *
 * А выгружает она его в windows-1251. Так по умолчанию сохраняет CSV Excel на
 * русской Windows, так отдаёт выгрузку 1С, и это первое, что делает магазин на
 * новой кассе, — заводит каталог файлом из старой программы.
 *
 * Правило простое и не требует угадывания: почти всякий текст в windows-1251
 * недопустим как UTF-8, поэтому сначала пробуем UTF-8 строго, а на отказе
 * читаем как windows-1251. Файл из одних латинских букв и цифр читается
 * одинаково обоими способами, так что ошибиться тут не на чем.
 */

/** Кодировка, в которой отдают выгрузки русские Windows-программы. */
const LEGACY = 'windows-1251';

export function decodeSheet(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    // Не UTF-8. Единственная другая кодировка, в которой сюда приходят файлы.
    return new TextDecoder(LEGACY).decode(view);
  }
}

/**
 * Прочитать файл таблицы текстом, чем бы его ни сохранили.
 *
 * Отдельно от компонентов: этот же файл выбирают на трёх экранах — импорт
 * каталога, накладная и прайс поставщика, — и все три читали его по-своему.
 */
export function readSheetFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(decodeSheet(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}
