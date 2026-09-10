import { useEffect, useState } from 'react';
import type { PriceListMatch, Supplier } from '../types';
import type { ImportSource } from '../api';
import { useTranslation } from '../i18n/useLanguage';
import { formatMoney, parseSheet } from '../utils';

interface Props {
  suppliers: Supplier[];
  match: PriceListMatch | null;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  createdOrderId: string | null;
  onBack: () => void;
  onMatch: (source: ImportSource) => void;
  onCreateOrder: (supplierId: string | null, items: { productId: string; quantity: number; price: number }[]) => void;
  onReset: () => void;
}

/**
 * Прайс поставщика → черновик заказа.
 *
 * Оптовик присылает таблицу, и дальше в магазине начинается вечер работы:
 * найти каждую позицию у себя, вспомнить прошлую цену, прикинуть остаток,
 * выписать заказ. Здесь это один экран.
 *
 * Три вещи, которые он показывает и которые обычно не видит никто:
 *
 *   1. **Что подорожало.** Поставщик не присылает список изменений цен — он
 *      присылает новый прайс. Сравнить его с прошлым руками невозможно, и
 *      поэтому подорожание замечают на третьем месяце, по упавшей марже.
 *   2. **Чего у нас нет.** Позиции, которых нет в каталоге, названы прямо, а
 *      не подставлены по похожести: ошибочно сопоставленный товар в заказе —
 *      это привезённое не то.
 *   3. **Сколько брать.** По нашему же расчёту дефицита, с учётом кратности
 *      поставщика.
 *
 * Заказ создаётся черновиком и всегда после выбора человека: файл, присланный
 * поставщиком, не должен превращаться в обязательство сам по себе.
 */
export function PriceListScreen({
  suppliers,
  match,
  loading,
  error,
  submitting,
  createdOrderId,
  onBack,
  onMatch,
  onCreateOrder,
  onReset,
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [xlsx, setXlsx] = useState<{ name: string; base64: string } | null>(null);
  const [supplierId, setSupplierId] = useState<string>('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [onlyNeeded, setOnlyNeeded] = useState(true);

  // Предложенные количества становятся начальными ровно один раз — когда
  // пришёл разбор. Иначе правка руками затиралась бы на каждой перерисовке.
  useEffect(() => {
    if (!match) return;
    const next: Record<string, number> = {};
    for (const line of match.lines) {
      if (line.productId) next[line.productId] = line.suggestedQuantity;
    }
    setQuantities(next);
  }, [match]);

  const grid = text.trim() ? parseSheet(text) : [];
  const source: ImportSource | null = xlsx ? { xlsxBase64: xlsx.base64 } : grid.length > 0 ? { grid } : null;

  function loadFile(file: File | undefined) {
    if (!file) return;
    onReset();
    if (/\.xlsx$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        setText('');
        setXlsx({ name: file.name, base64: btoa(binary) });
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setXlsx(null);
      setText(String(reader.result ?? ''));
    };
    reader.readAsText(file, 'utf-8');
  }

  const chosen = match
    ? match.lines
        .filter((line) => line.productId && (quantities[line.productId] ?? 0) > 0)
        .map((line) => ({
          productId: line.productId!,
          quantity: quantities[line.productId!],
          price: line.supplierPrice ?? 0,
        }))
    : [];
  const chosenTotal = match
    ? chosen.reduce((sum, item) => sum + Math.round(item.price * item.quantity), 0)
    : 0;

  const visible = match
    ? match.lines.filter((line) => !onlyNeeded || line.suggestedQuantity > 0 || line.priceChangePercent !== null)
    : [];

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('priceList.title')}</span>
      </div>

      <div className="screen-body">
        {createdOrderId ? (
          <>
            <div className="orders-section-title">{t('priceList.done')}</div>
            <p className="field-hint">{t('priceList.doneHint')}</p>
            <button className="btn btn-secondary btn-block" onClick={() => { setText(''); setXlsx(null); onReset(); }}>
              {t('priceList.another')}
            </button>
          </>
        ) : (
          <>
            <p className="field-hint">{t('priceList.intro')}</p>

            {!match && (
              <>
                <div className="form-field">
                  <label htmlFor="price-file">{t('import.file')}</label>
                  <input
                    id="price-file"
                    type="file"
                    accept=".xlsx,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => loadFile(e.target.files?.[0])}
                  />
                  {xlsx && <span className="field-hint">{t('import.chosen', { name: xlsx.name })}</span>}
                </div>

                <div className="form-field">
                  <label htmlFor="price-text">{t('import.orPaste')}</label>
                  <textarea
                    id="price-text"
                    rows={6}
                    value={text}
                    onChange={(e) => { setText(e.target.value); onReset(); }}
                  />
                </div>

                <button
                  className="btn btn-primary btn-block"
                  disabled={!source || loading}
                  onClick={() => source && onMatch(source)}
                >
                  {loading ? t('priceList.matching') : t('priceList.match')}
                </button>
              </>
            )}

            {error && <div className="login-error">{error}</div>}

            {match && (
              <>
                <div className="report-cards">
                  <div className="report-card">
                    <span className="value">{match.summary.matched}</span>
                    <span className="label">{t('priceList.matched')}</span>
                  </div>
                  {match.summary.unmatched > 0 && (
                    <div className="report-card">
                      <span className="value">{match.summary.unmatched}</span>
                      <span className="label">{t('priceList.unmatched')}</span>
                    </div>
                  )}
                  {match.summary.dearer > 0 && (
                    <div className="report-card low">
                      <span className="value">{match.summary.dearer}</span>
                      <span className="label">{t('priceList.dearer')}</span>
                    </div>
                  )}
                  {match.summary.cheaper > 0 && (
                    <div className="report-card">
                      <span className="value">{match.summary.cheaper}</span>
                      <span className="label">{t('priceList.cheaper')}</span>
                    </div>
                  )}
                </div>

                {/* Самое заметное подорожание названо словами: поставщик
                    присылает не список изменений, а новый прайс, и заметить
                    это глазами нельзя. */}
                {match.summary.biggestRise && (
                  <p className="field-hint">
                    {t('priceList.biggestRise', {
                      name: match.summary.biggestRise.name,
                      percent: match.summary.biggestRise.percent,
                    })}
                  </p>
                )}
                {match.problems.map((problem) => (
                  <p key={problem} className="order-meta">{problem}</p>
                ))}

                <div className="form-field">
                  <label htmlFor="price-supplier">{t('priceList.supplier')}</label>
                  <select id="price-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">{t('priceList.noSupplier')}</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                    ))}
                  </select>
                </div>

                <label className="cab-check">
                  <input type="checkbox" checked={onlyNeeded} onChange={(e) => setOnlyNeeded(e.target.checked)} />
                  {t('priceList.onlyNeeded')}
                </label>

                <div className="orders-section-title">
                  {t('priceList.lines', { count: visible.length })}
                </div>

                {visible.map((line) => (
                  <div key={line.line} className="report-row">
                    <span>
                      {line.ourName ?? line.supplierName}
                      <br />
                      <span className="order-meta">
                        {line.supplierPrice !== null ? formatMoney(line.supplierPrice) : '—'}
                        {line.priceChangePercent !== null && (
                          <span className={line.priceChangePercent > 0 ? 'price-up' : 'price-down'}>
                            {' '}{line.priceChangePercent > 0 ? '+' : ''}{line.priceChangePercent} %
                          </span>
                        )}
                        {line.available !== null ? ` · ${t('priceList.onShelf', { count: line.available })}` : ''}
                        {line.daysOfCover !== null ? ` · ${t('priceList.cover', { days: line.daysOfCover })}` : ''}
                      </span>
                    </span>

                    {line.productId ? (
                      <input
                        className="qty-input"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={quantities[line.productId] ?? 0}
                        onChange={(e) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [line.productId!]: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                      />
                    ) : (
                      <span className="pill warn">{t('priceList.notOurs')}</span>
                    )}
                  </div>
                ))}

                {match.truncated && <p className="order-meta">{t('priceList.truncated')}</p>}

                <button
                  className="btn btn-primary btn-block"
                  disabled={chosen.length === 0 || submitting}
                  onClick={() => onCreateOrder(supplierId || null, chosen)}
                >
                  {submitting
                    ? t('common.saving')
                    : t('priceList.create', { count: chosen.length, total: formatMoney(chosenTotal) })}
                </button>
                <p className="order-meta">{t('priceList.draftOnly')}</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
