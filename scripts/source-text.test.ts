import { describe, it, expect } from 'vitest';
import { withoutComments } from './lib/source-text.mjs';

/**
 * Разборщик, на который опираются охраны, читающие исходник.
 *
 * Если он ошибётся в одну сторону — охрана примет комментарий за код и
 * пропустит отключённую строку. В другую — вырежет кусок настоящего кода, и
 * охрана начнёт падать на исправном месте. Обе ошибки одинаково плохи, поэтому
 * здесь проверяются обе.
 */

describe('исходник без комментариев', () => {
  it('убирает строчный комментарий', () => {
    expect(withoutComments('const a = 1; // хвост\nconst b = 2;')).toBe('const a = 1; \nconst b = 2;');
  });

  it('убирает блочный, сохраняя переводы строк', () => {
    /* Номера строк охраны считают по переводам: съесть их значило бы сдвинуть
       все ссылки на строки в отчётах. */
    const было = 'a\n/* один\n   два */\nb';
    const стало = withoutComments(было);
    expect(стало).not.toContain('один');
    expect(стало.split('\n')).toHaveLength(было.split('\n').length);
  });

  it('и закомментированную разметку — тоже', () => {
    // Ровно тот случай, ради которого всё написано.
    const src = '  {/* onSwitchCashier={handleLogout} */}';
    expect(withoutComments(src)).not.toContain('onSwitchCashier={handleLogout}');
  });

  it('но не трогает то, что внутри строки', () => {
    /* В текстах отказов встречаются и слэши, и звёздочки. Вырезать их значило
       бы уронить охрану на исправном коде — ошибка в другую сторону. */
    expect(withoutComments(`const s = 'путь // не комментарий';`)).toContain('путь // не комментарий');
    expect(withoutComments('const s = "/* и это тоже */";')).toContain('/* и это тоже */');
    expect(withoutComments('const s = `шаблон // внутри`;')).toContain('шаблон // внутри');
  });

  it('и экранированную кавычку внутри строки', () => {
    // Иначе строка «не закроется», и весь остаток файла сочтётся строкой.
    const src = `const s = 'он сказал \\'да\\''; // хвост`;
    const out = withoutComments(src);
    expect(out).toContain("он сказал");
    expect(out).not.toContain('хвост');
  });

  it('а для CSS строчные комментарии выключаются', () => {
    /* В CSS `//` не комментарий, а часть адреса. Съесть остаток строки значило
       бы уронить охрану вёрстки на исправном файле. */
    const css = '@import url(https://fonts.example/x.css); .a { color: red; } /* прочь */';
    const out = withoutComments(css, { lineComments: false });
    expect(out).toContain('https://fonts.example/x.css');
    expect(out).not.toContain('прочь');
  });

  it('и делитель не путает с комментарием', () => {
    expect(withoutComments('const x = a / b; const y = c / d;')).toContain('a / b');
  });
});
