/**
 * Узнать базу, которая поднялась, но ещё не готова отвечать.
 *
 * Postgres после незакрытого выключения доигрывает журнал. В это время он уже
 * принимает соединения — порт открыт, `pg_isready` отвечает «готова», — но на
 * первый же запрос отвечает FATAL. Состояние проходит за секунды.
 *
 * Отличать его от настоящих отказов важно потому, что ответ на него другой:
 * недоступную базу надо поднять, нарушенную уникальность — разобрать, а эту —
 * просто переждать. Прогон тестов, начатый в эту секунду, даёт не одну ошибку,
 * а несколько сотен, по числу тестов, и ни одна из них не про базу.
 */
export function stillStarting(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return (
    text.includes('not yet accepting connections') ||
    text.includes('Consistent recovery state has not been yet reached') ||
    text.includes('starting up')
  );
}

/** Сколько ждём восстановления, прежде чем сказать, что оно затянулось. */
export const RECOVERY_WAIT_MS = 30000;
