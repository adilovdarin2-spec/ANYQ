import { useCallback, useEffect, useRef, useState } from 'react';
import { checkLicence } from '../api';
import type { LicenceCheck } from '../api';
import { getLicenceConfirmedAt, saveLicenceConfirmedAt } from '../storage';
import { CHECK_EVERY_MS, dueForCheck, dueForReminder, outOfTouch } from '../licence';

/**
 * Раз в час спросить сервер, оплачен ли месяц.
 *
 * Держит три вещи, и каждая — ответ на отдельный вопрос человека за кассой.
 *
 * «Тариф ещё жив?» — свежий ответ сервера, которым касса обновляет то, что
 * прочитала на входе. Без этого магазин, у которого тариф кончился в
 * понедельник, узнавал бы об этом при следующем входе, а токен кассы живёт
 * тридцать дней.
 *
 * «Почему касса ничего не знает?» — `outOfTouch`. Час без подтверждения, и
 * касса говорит «подключите интернет». Торговать при этом не перестаёт: магазин
 * без интернета не должен переставать работать.
 *
 * «Мне пора звонить владельцу?» — напоминание в последние сутки, раз в четыре
 * часа, с кнопкой, которую надо нажать. Полоска в шапке к этому моменту висит
 * уже неделю и перестала читаться.
 *
 * Ошибка запроса — не событие. Сеть отваливается по десять раз в день, и
 * красная строка на каждый обрыв — это то, из-за чего перестают читать красные
 * строки. Молчание считается временем, а не случаем: `outOfTouch` скажет своё,
 * когда молчание станет длинным.
 */
export interface Licence {
  /** Свежий тариф, если сервер успел ответить. `null` — пользуйтесь тем, что в сессии. */
  tariff: { validUntil: string; daysLeft: number } | null;
  /** Больше часа без ответа сервера. */
  outOfTouch: boolean;
  /** Пора показать окно про конец тарифа. Гасится `dismissReminder`. */
  remind: boolean;
  dismissReminder: () => void;
}

interface Options {
  /** Сколько осталось по сессии — пока сервер не ответил впервые. */
  fallback: { validUntil: string; daysLeft: number } | null | undefined;
  /** Тариф кончился или магазин заморожен: слова сервера, на экран входа. */
  onRefused: (message: string) => void;
}

export function useLicence(token: string | null, { fallback, onRefused }: Options): Licence {
  const [fresh, setFresh] = useState<LicenceCheck['tariff']>(null);
  const [confirmedAt, setConfirmedAt] = useState<number | null>(() => getLicenceConfirmedAt());
  const [remindedAt, setRemindedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const checkedAt = useRef<number | null>(null);
  // Отказ сервера уводит на экран входа, и делать это надо один раз: обработчик
  // меняет сессию, эффект перезапускается, и без этого касса ушла бы в круг.
  const refused = useRef(false);
  /**
   * Обработчик отказа — через ref, а не в зависимостях эффекта.
   *
   * Он объявлен внутри App и потому новый на каждой отрисовке. В зависимостях
   * это значит: эффект пересоздаётся на каждую отрисовку, уборка ставит
   * `alive = false` — и ответ уже улетевшего запроса выбрасывается на
   * `if (!alive) return`. А `checkedAt` при этом уже проставлен, так что
   * следующий запрос уйдёт через час. Касса молча не проверяла лицензию
   * никогда и вечно показывала «подключите интернет»; проверено вживую.
   */
  const refusalHandler = useRef(onRefused);
  refusalHandler.current = onRefused;
  /**
   * Запрос уже в пути.
   *
   * Не то же самое, что `checkedAt`, и обойтись одним из двух не выходит.
   * `checkedAt` ставится по завершении — иначе оборванный запрос считался бы
   * проверкой и следующая ушла бы через час. Но тогда между отправкой и
   * ответом `dueForCheck` по-прежнему говорит «пора», и второй вызов —
   * от таймера, от пробуждения планшета, от второго запуска эффекта в
   * StrictMode — отправил бы дубль.
   */
  const inFlight = useRef(false);

  const tariff = fresh ?? fallback ?? null;

  useEffect(() => {
    if (!token) return;
    refused.current = false;
    // Перечитываем: вход записал сюда время, и это доказанная связь.
    setConfirmedAt(getLicenceConfirmedAt());

    async function ask() {
      if (refused.current || inFlight.current) return;
      if (!dueForCheck(Date.now(), checkedAt.current)) return;
      inFlight.current = true;
      try {
        const answer = await checkLicence(token!);
        const at = Date.now();
        checkedAt.current = at;
        saveLicenceConfirmedAt(at);
        // Без проверки «жив ли эффект», и это важно. В StrictMode эффект
        // запускается, убирается и запускается снова, а ответ приходит уже
        // после уборки первого: выброси его — и касса вечно показывает
        // «подключите интернет», ни разу лицензию не проверив. Так и было.
        // Компонент при этом тот же самый, refs и состояние у него общие, так
        // что обновлять их безопасно.
        setFresh(answer.tariff);
        setConfirmedAt(at);
        if (answer.state !== 'active' && answer.refusal) {
          refused.current = true;
          refusalHandler.current(answer.refusal);
        }
      } catch {
        // Молчим, но помечаем попытку: иначе касса без сети колотилась бы в
        // неё каждую минуту вместо раза в час. `outOfTouch` скажет своё, когда
        // молчание станет длинным.
        checkedAt.current = Date.now();
      } finally {
        inFlight.current = false;
      }
    }

    ask();
    // Тикаем чаще, чем спрашиваем: «подключите интернет» и напоминание раз в
    // четыре часа считаются по тем же часам, и ждать целый час, чтобы заметить,
    // что час прошёл, — значит опаздывать на час.
    const timer = window.setInterval(() => {
      setNow(Date.now());
      ask();
    }, TICK_MS);
    // Планшет спал — часы шли. Смотрим сразу, а не через час.
    const onWake = () => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [token]);

  const dismissReminder = useCallback(() => setRemindedAt(Date.now()), []);

  return {
    tariff,
    outOfTouch: token !== null && outOfTouch(now, confirmedAt),
    remind: token !== null && dueForReminder(tariff?.daysLeft, now, remindedAt),
    dismissReminder,
  };
}

/**
 * Как часто пересчитываются часы.
 *
 * Не то же самое, что `CHECK_EVERY_MS`: спрашиваем сервер раз в час, а смотрим
 * на часы раз в минуту. Минута — это точность, с которой должно появиться
 * «подключите интернет»; час означал бы, что оно опаздывает в среднем на
 * полчаса. Сам запрос при этом всё равно уходит раз в час — за него отвечает
 * `dueForCheck`, а не этот таймер.
 */
const TICK_MS = Math.min(60 * 1000, CHECK_EVERY_MS);
