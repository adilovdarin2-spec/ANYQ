import { useEffect, useState } from 'react';
import { serverReachable, subscribeReachable } from '../reachable';

/**
 * Есть ли у устройства сеть — по мнению браузера.
 *
 * Этим вопросом живут циклы досылки: пока сеть есть, пробовать стоит. Спросить
 * их вместо этого «доехал ли последний запрос» нельзя, и это не теория — так и
 * было сделано в первой попытке: признак гас при обрыве, цикл переставал
 * пробовать, а снять признак могла только удачная попытка. Продажа осталась
 * неотправленной и после возвращения сервера.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

/**
 * Уходят ли продажи — то, что читает кассир на полоске в шапке.
 *
 * Отдельно от цикла повторов намеренно. Полоска отвечает за правду: она
 * говорила «Онлайн», пока рядом копилось «не отправлено», потому что
 * спрашивала про сетевую карту, а вайфай без интернета — обычный вечер. Цикл
 * же обязан оставаться упрямым: перестать пробовать по той же причине значит
 * не отправить ничего никогда.
 */
export function useServerReachable(): boolean {
  const browserOnline = useOnlineStatus();
  const [reachable, setReachable] = useState(serverReachable);

  useEffect(() => subscribeReachable(() => setReachable(serverReachable())), []);

  return browserOnline && reachable;
}
