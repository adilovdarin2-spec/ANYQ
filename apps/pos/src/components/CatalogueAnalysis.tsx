import type { CatalogueAnalysis } from '../types';
import { useTranslation } from '../i18n/useLanguage';
import { formatMoney } from '../utils';

/**
 * Разбор каталога — то, что видно про магазин по одному файлу выгрузки.
 *
 * Стоит выше блока «что произойдёт» намеренно. «Будет добавлено 3 000 товаров»
 * — это про нас; «34 товара вы продаёте дешевле, чем покупаете» — это про него,
 * и ради второго он и прислал файл.
 *
 * Каждая цифра здесь посчитана по его строкам. То, что посчитать не удалось,
 * не заполняется нулём и не додумывается: внизу списком сказано, чего в файле
 * не было и что из этого не следует. Приём держится ровно на том, что здесь
 * нет ни одной выдуманной цифры.
 */
export function CatalogueAnalysisPanel({ analysis }: { analysis: CatalogueAnalysis }) {
  const { t, s } = useTranslation();

  if (analysis.products === 0) {
    return <p className="field-hint">{s(analysis.notes[0])}</p>;
  }

  const lossy = analysis.atLoss;

  return (
    <>
      <div className="orders-section-title">{t('analysis.title')}</div>

      <div className="report-cards">
        <div className="report-card">
          <span className="value">{analysis.products}</span>
          <span className="label">{t('analysis.products')}</span>
        </div>
        {analysis.stockValue !== null && (
          <div className="report-card">
            <span className="value">{formatMoney(analysis.stockValue)}</span>
            <span className="label">{t('analysis.stockValue')}</span>
          </div>
        )}
        {lossy && lossy.count > 0 && (
          <div className="report-card low">
            <span className="value">{lossy.count}</span>
            <span className="label">{t('analysis.atLoss')}</span>
          </div>
        )}
        {analysis.duplicates.count > 0 && (
          <div className="report-card low">
            <span className="value">{analysis.duplicates.count}</span>
            <span className="label">{t('analysis.duplicates')}</span>
          </div>
        )}
        {analysis.noBarcode > 0 && (
          <div className="report-card">
            <span className="value">{analysis.noBarcode}</span>
            <span className="label">{t('analysis.noBarcode')}</span>
          </div>
        )}
        {analysis.markup && (
          <div className="report-card">
            <span className="value">{analysis.markup.median} %</span>
            <span className="label">{t('analysis.medianMarkup')}</span>
          </div>
        )}
      </div>

      {/* Названия, а не только счётчик: «34 товара в минус» — это цифра, а
          «Сахар: покупаете за 500, продаёте за 450» — это то, что человек
          проверит в своей же программе через минуту и после чего поверит
          остальному. */}
      {lossy && lossy.examples.length > 0 && (
        <>
          <div className="orders-section-title">{t('analysis.atLossTitle')}</div>
          {/* Ключ по номеру, а не по названию: один и тот же товар может быть
              заведён дважды, и React тогда рисует одну строку вместо двух. */}
          {lossy.examples.map((item, index) => (
            <div key={`${item.name}-${index}`} className="report-row low">
              <span>
                {item.name}
                <br />
                <span className="order-meta">
                  {t('analysis.atLossRow', {
                    purchase: formatMoney(item.purchasePrice),
                    sale: formatMoney(item.salePrice),
                  })}
                </span>
              </span>
              <span className="pill warn">−{formatMoney(item.purchasePrice - item.salePrice)}</span>
            </div>
          ))}
          {lossy.count > lossy.examples.length && (
            <p className="order-meta">
              {t('analysis.andMore', { count: lossy.count - lossy.examples.length })}
            </p>
          )}
        </>
      )}

      {analysis.duplicates.examples.length > 0 && (
        <>
          <div className="orders-section-title">{t('analysis.duplicatesTitle')}</div>
          {analysis.duplicates.examples.map((item) => (
            <div key={`${item.name}-${item.lines[0]}`} className="report-row">
              <span>
                {item.name}
                <br />
                <span className="order-meta">
                  {t('analysis.duplicateRows', { lines: item.lines.join(', ') })}
                </span>
              </span>
            </div>
          ))}
        </>
      )}

      {analysis.markup && analysis.markup.byCategory.length > 0 && (
        <>
          <div className="orders-section-title">{t('analysis.markupTitle')}</div>
          {analysis.markup.byCategory.map((row) => (
            <div key={s(row.category)} className="report-row">
              <span>
                {row.category}
                <br />
                <span className="order-meta">{t('analysis.markupItems', { count: row.items })}</span>
              </span>
              <span className="pill">{row.medianMarkup} %</span>
            </div>
          ))}
        </>
      )}

      {analysis.atZero !== null && analysis.atZero > 0 && (
        <p className="field-hint">{t('analysis.atZero', { count: analysis.atZero })}</p>
      )}
      {analysis.noPurchasePrice > 0 && (
        <p className="field-hint">{t('analysis.noPurchasePrice', { count: analysis.noPurchasePrice })}</p>
      )}

      {/* Чего в файле не было. Показывается всегда — это половина честности
          разбора: без неё пустая цифра читается как «у вас этого нет». */}
      <div className="orders-section-title">{t('analysis.notCounted')}</div>
      {analysis.notes.map((note) => (
        <p key={note} className="order-meta">
          {s(note)}
        </p>
      ))}
    </>
  );
}
