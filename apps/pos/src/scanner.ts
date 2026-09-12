/**
 * Сканер на терминале печатает туда, где стоит курсор.
 *
 * Штрихкод-сканер — это клавиатура: он «набирает» цифры и жмёт Enter. Касса
 * ловит их полем поиска, но только если курсор стоит в поле. На телефоне это
 * не вопрос — там в поле тыкают пальцем; на терминале курсор уезжает от
 * первого же нажатия: кассир нажал плитку, нажал «+», открыл и закрыл
 * что-нибудь — и следующий скан уходит в пустоту. Товар не добавился, кассир
 * сканирует ещё раз, и ещё, а на экране ничего.
 *
 * Поэтому на терминале печатный символ, пришедший «в никуда», возвращает
 * курсор в поиск и попадает в него. Остальные символы штрихкода приходят уже в
 * сфокусированное поле, Enter добавляет товар — так же, как если бы в поле
 * кликнули заранее.
 */

/** То, что нужно знать о нажатии, чтобы решить. Не сам KeyboardEvent — так это проверяемо. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Куда нажатие пришло: имя тега и признак contenteditable. */
  targetTag: string;
  targetEditable: boolean;
}

/**
 * Нужно ли увести это нажатие в поле поиска.
 *
 * Отказы здесь важнее согласий, и каждый стоит отдельно:
 *
 * - **нажатие уже в поле** — человек печатает в количество, в цену, в имя
 *   клиента; перехват означал бы, что набранное исчезает на глазах;
 * - **сочетание с Ctrl, Alt или Cmd** — это команда браузеру или системе, а не
 *   символ: Ctrl+V в поиск ничего не вставит, зато сломает вставку;
 * - **не один символ** — Enter, Tab, стрелки и F5 имеют свой смысл, и отнимать
 *   его у них значит ломать клавиатуру ради сканера;
 * - **пробел** — на кнопке он её нажимает, и перехват сделал бы клавиатурную
 *   навигацию неработающей.
 */
export function shouldRedirectToSearch(press: KeyPress): boolean {
  if (press.ctrlKey || press.metaKey || press.altKey) return false;
  if (press.key.length !== 1) return false;
  if (press.key === ' ') return false;
  if (press.targetEditable) return false;
  const tag = press.targetTag.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  return true;
}

/** Нажатие из настоящего события — в то, что проверяет функция выше. */
export function pressFrom(event: KeyboardEvent): KeyPress {
  const target = event.target as HTMLElement | null;
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    targetTag: target?.tagName ?? '',
    targetEditable: Boolean(target?.isContentEditable),
  };
}
