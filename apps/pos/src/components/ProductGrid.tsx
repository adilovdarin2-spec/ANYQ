import type { Product } from '../types';
import { useTranslation } from '../i18n/useLanguage';
import { formatMoney, formatWeight } from '../utils';

interface Props {
  products: Product[];
  cartQtyByProduct: Record<string, number>;
  onPick: (product: Product) => void;
  canManageStopList?: boolean;
  onToggleStopList?: (product: Product) => void;
}

/**
 * Сколько плиток рисуется за раз.
 *
 * Плитка — это кнопка с четырьмя вложенными узлами, и на три тысячи товаров
 * выходило восемнадцать тысяч узлов в дереве. Замер на настольной машине: одна
 * буква в поиске, пока найденных остаётся много, — 169 мс, стирание обратно до
 * полного списка — 351 мс. Планшет за тридцать тысяч тенге медленнее в
 * несколько раз, то есть касса замирает между буквами — ровно в ту секунду,
 * когда кассир печатает название при очереди.
 *
 * Сто пятьдесят — это заметно больше, чем помещается на экране, и заметно
 * меньше, чем стоит рисовать. До плитки за номером 150 никто не доскроллит:
 * товар ищут сканером или поиском, а сетка нужна для того, у чего нет
 * штрихкода. Поэтому остальное не прячется молча — под сеткой стоит строка,
 * которая говорит, сколько всего нашлось, и что делать дальше.
 */
export const GRID_LIMIT = 150;

export function ProductGrid({ products, cartQtyByProduct, onPick, canManageStopList, onToggleStopList }: Props) {
  const { t } = useTranslation();
  if (products.length === 0) {
    return <div className="empty-state">{t('grid.nothingFound')}</div>;
  }

  const shown = products.slice(0, GRID_LIMIT);

  return (
    <div className="product-grid">
      {shown.map((p) => {
        const remaining = p.stock - (cartQtyByProduct[p.id] ?? 0);
        const out = remaining <= 0 || p.stopListed;
        return (
          <div key={p.id} className="product-tile-wrap">
            <button className={`product-tile${out ? ' out' : ''}`} disabled={out} onClick={() => onPick(p)}>
              <span className="p-name">{p.name}</span>
              <span className="p-footer">
                <span className="p-price">{formatMoney(p.price)}{p.saleUnit === 'weight' ? t('grid.perKg') : ''}</span>
                {p.stopListed ? (
                  <span className="p-stock low">{t('grid.stopListed')}</span>
                ) : (
                  <span className={`p-stock${remaining <= 5 ? ' low' : ''}`}>
                    {out
                    ? t('grid.outOfStock')
                    : t('grid.leftWeight', { amount: p.saleUnit === 'weight' ? formatWeight(remaining) : remaining })}
                  </span>
                )}
              </span>
            </button>
            {canManageStopList && onToggleStopList && (
              <button
                type="button"
                className="stop-list-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStopList(p);
                }}
                aria-label={p.stopListed ? t('grid.removeFromStopList') : t('grid.addToStopList')}
              >
                {p.stopListed ? '✓' : '⛔'}
              </button>
            )}
          </div>
        );
      })}
      {/* Внутри сетки, а не под ней: у сетки снизу сто пикселей отступа под
          панель вкладок, и строка, поставленная следующей за ней, уезжала
          ровно под эту панель — то есть её не было видно вообще. */}
      {products.length > shown.length && (
        <p className="field-hint grid-overflow">
          {t('grid.showingFirst', { shown: shown.length, total: products.length })}
        </p>
      )}
    </div>
  );
}
