/**
 * Повтор запроса, который не доехал до базы, — для скриптов.
 *
 * Правило то же, что в приложении (`packages/db/src/reconnect.ts`), и по той же
 * причине: P1001 означает «не удалось открыть соединение», то есть запрос до
 * сервера не дошёл, не выполнился и ничего не изменил. Такой можно послать
 * заново, не разбираясь, что он делал. Всё остальное — нарушенная
 * уникальность, кончившийся пул, вышедший срок транзакции — до базы дошло:
 * повторить списание остатка «на всякий случай» значит списать дважды.
 *
 * Отдельная копия, а не импорт, по скучной причине: скрипты — обычный node, а
 * тот модуль на TypeScript. Держать их в согласии придётся руками; поэтому
 * здесь одна маленькая функция с тем же правилом, а не своя политика.
 *
 * Зачем это скриптам. `smoke.mjs` — проверка развёртывания, и она ходит в базу
 * ровно один раз: отозвать токен и убедиться, что старый перестал работать.
 * Одна секунда сетевой ряби на этом шаге обрывала весь прогон строкой «run did
 * not finish» — после четырёх десятков пройденных проверок. Человек, читающий
 * такой вывод после деплоя, видит сломанное развёртывание там, где сломалась
 * одна попытка подключиться.
 */

export const ATTEMPTS = 3;
export const PAUSE_MS = 150;

/**
 * Запрос не дошёл до базы — в отличие от «дошёл и не понравился».
 *
 * Два признака, потому что одного не хватило: у живой ошибки Prisma 6.19
 * `errorCode` равен `undefined`, хотя в документации написано «P1001». Код
 * есть в тексте, но не в поле. Подробности — в packages/db/src/reconnect.ts.
 */
export function unreachable(error) {
  if (typeof error !== 'object' || error === null) return false;
  if (error.errorCode === 'P1001' || error.code === 'P1001') return true;
  const text = typeof error.message === 'string' ? error.message : '';
  return error.name === 'PrismaClientInitializationError' && text.includes("Can't reach database server");
}

export async function retryUnreachable(run, pause = (ms) => new Promise((r) => setTimeout(r, ms))) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= ATTEMPTS || !unreachable(error)) throw error;
      await pause(PAUSE_MS * attempt);
    }
  }
}
