import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withoutComments } from '../../../scripts/lib/source-text.mjs';

/**
 * Из раздела всегда есть выход.
 *
 * У экрана в кассе два способа закрыться: стрелка «назад» в шапке и нижняя
 * панель. Подэкраны — приёмка, экспорт, закрытие смены — рисуются классом
 * `.screen`, накрывают всё и выходят стрелкой. Разделы стрелки не имеют
 * нарочно: возвращаться им некуда, их выход — панель.
 *
 * Зал и заказы были нарисованы тем же `.screen` — `inset: 0` поверх панели с
 * `z-index: 26`. Панель оставалась в разметке, но её не было ни видно, ни
 * нажать: браузер в точке кнопки отдавал тело экрана. А зал и заказы — ещё и
 * первый экран смены: кафе открывается залом, оптовику открываются заказы.
 * Официант входил в кассу и оставался в зале до перезапуска приложения.
 *
 * Правило простое: экран без стрелки «назад» не имеет права накрывать панель.
 */

const COMPONENTS = resolve(__dirname, 'components');
const CSS = resolve(__dirname, 'styles', 'global.css');

/** Корневые экраны разделов: выход у них только через нижнюю панель. */
const TAB_ROOT_SCREENS = ['FloorPlanScreen.tsx', 'OrdersScreen.tsx'];

function read(file: string): string {
  return withoutComments(readFileSync(resolve(COMPONENTS, file), 'utf8').replace(/\r\n/g, '\n'));
}

/** Открывающий `div` экрана со всеми его классами. */
export function screenClasses(source: string): string[] {
  const m = /<div className="(screen[^"]*)"/.exec(source);
  return m ? m[1].split(/\s+/) : [];
}

describe('корневой экран раздела не накрывает нижнюю панель', () => {
  it.each(TAB_ROOT_SCREENS)('%s помечен как раздел, а не подэкран', (file) => {
    const classes = screenClasses(read(file));
    expect(classes, 'экран вообще не разобрался').toContain('screen');
    expect(classes, 'без этого панель под ним, и выйти некуда').toContain('screen--tab');
  });

  it.each(TAB_ROOT_SCREENS)('%s и правда без стрелки «назад»', (file) => {
    /* Обратная сторона правила. Появится стрелка — экран перестанет зависеть
       от панели, и метку можно будет снять осознанно, а не забыть поставить. */
    const source = read(file);
    expect(source).not.toMatch(/screen-back|onBack|aria-label=\{t\('common\.back'\)\}/);
  });

  it('а сама метка поднимает низ экрана ровно на высоту панели', () => {
    const css = withoutComments(readFileSync(CSS, 'utf8').replace(/\r\n/g, '\n'), { lineComments: false });
    const rule = /\.screen\.screen--tab \{([^}]*)\}/.exec(css);
    expect(rule, 'правило не найдено — метка ничего не делает').toBeTruthy();
    // Панель — это её высота плюс безопасная зона снизу; вычесть надо обе,
    // иначе на телефоне с полосой жестов нижний ряд кнопок снова уедет под неё.
    expect(rule![1]).toContain('bottom: calc(var(--tab-bar-h) + env(safe-area-inset-bottom))');
  });

  it('и высота панели в этом правиле — та же переменная, что у самой панели', () => {
    // Два разных числа разошлись бы при первой же правке, и щель между экраном
    // и панелью никто бы не связал с этим файлом.
    const css = withoutComments(readFileSync(CSS, 'utf8').replace(/\r\n/g, '\n'), { lineComments: false });
    const bar = /\.tab-bar \{([^}]*)\}/.exec(css);
    expect(bar, 'не разобралось правило панели').toBeTruthy();
    expect(bar![1]).toContain('height: var(--tab-bar-h)');
  });
});
