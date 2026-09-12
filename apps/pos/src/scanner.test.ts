import { describe, it, expect } from 'vitest';
import { shouldRedirectToSearch } from './scanner';
import type { KeyPress } from './scanner';

/**
 * Куда уходит скан, когда курсор не в поле поиска.
 *
 * На терминале это происходит постоянно: нажали плитку, нажали «+», закрыли
 * окно — курсор уехал, и следующий штрихкод уходит в пустоту. Кассир сканирует
 * ещё раз, и ещё; на экране ничего.
 *
 * Обратная сторона дороже: перехватить лишнее — значит сломать клавиатуру.
 * Поэтому отказы здесь проверяются подробнее, чем согласия.
 */

const нажатие = (over: Partial<KeyPress> = {}): KeyPress => ({
  key: '4',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  targetTag: 'DIV',
  targetEditable: false,
  ...over,
});

describe('перехват скана', () => {
  it('цифра, пришедшая в никуда, уходит в поиск', () => {
    expect(shouldRedirectToSearch(нажатие())).toBe(true);
    expect(shouldRedirectToSearch(нажатие({ key: '7', targetTag: 'BUTTON' }))).toBe(true);
    expect(shouldRedirectToSearch(нажатие({ key: 'ы' }))).toBe(true);
  });

  it('нажатие внутри поля не трогается', () => {
    // Иначе набранное в количестве, в цене или в имени клиента исчезало бы на
    // глазах у того, кто его набирает.
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(shouldRedirectToSearch(нажатие({ targetTag: tag })), tag).toBe(false);
    }
    expect(shouldRedirectToSearch(нажатие({ targetEditable: true }))).toBe(false);
  });

  it('сочетания с Ctrl, Alt и Cmd — команды, а не символы', () => {
    expect(shouldRedirectToSearch(нажатие({ ctrlKey: true, key: 'v' }))).toBe(false);
    expect(shouldRedirectToSearch(нажатие({ metaKey: true, key: 'c' }))).toBe(false);
    expect(shouldRedirectToSearch(нажатие({ altKey: true, key: 'f' }))).toBe(false);
  });

  it('служебные клавиши остаются служебными', () => {
    // Enter добавляет товар, Tab ходит по кнопкам, F5 перезагружает. Отнимать
    // у них смысл ради сканера значит ломать клавиатуру.
    for (const key of ['Enter', 'Tab', 'Escape', 'ArrowDown', 'F5', 'Backspace']) {
      expect(shouldRedirectToSearch(нажатие({ key })), key).toBe(false);
    }
  });

  it('пробел не перехватывается', () => {
    // На кнопке пробел её нажимает. Перехват сделал бы клавиатурную навигацию
    // неработающей — а на терминале это единственный способ работать без мыши.
    expect(shouldRedirectToSearch(нажатие({ key: ' ', targetTag: 'BUTTON' }))).toBe(false);
  });
});
