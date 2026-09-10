import { useEffect, useState } from 'react';
import type { DeliveryMatch } from '../types';
import type { ImportSource } from '../api';
import { useTranslation } from '../i18n/useLanguage';
import { formatMoney, parseSheet } from '../utils';

interface Props {
  match: DeliveryMatch | null;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  receivedId: string | null;
  onBack: () => void;
  onMatch: (source: ImportSource) => void;
  onReceive: (items: { productId: string; quantity: number; price: number }[]) => void;
  onReset: () => void;
}

/**
 * Приёмка по накладной, присланной файлом.
 *
 * Приёмка — сорок минут ручного ввода и самая ненавидимая операция в магазине.
 * Распознать фотографию бумажной накладной мы пока не умеем, а вот накладную,
 * присланную файлом — а её присылают файлом чаще, чем кажется, — читаем тем же
 * разбором, что и каталог. Печатать не нужно ничего: кладовщик только сверяет.
 *
 * И вот это «только сверяет» — не оговорка, а суть экрана. Количество из файла
 * подставлено, но остаётся полем ввода, и кнопка называет то, что произойдёт:
 * принимается то, что стоит в полях, а не то, что написал поставщик. Накладная
 * — заявление поставщика о том, что он привёз; приёмка — наше утверждение о
 * том, что мы получили, и подписывать второе первым нельзя.
 */
export function DeliveryNoteScreen({
  match,
  loading,
  error,
  submitting,
  receivedId,
  onBack,
  onMatch,
  onReceive,
  onReset,
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [xlsx, setXlsx] = useState<{ name: string; base64: string } | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!match) return;
    const next: Record<string, number> = {};
    for (const line of match.lines) {
      if (line.productId) next[line.productId] = line.quantity ?? 0;
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
          price: line.receiptPrice,
        }))
    : [];
  const total = chosen.reduce((sum, item) => sum + Math.round(item.price * item.quantity), 0);

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('delivery.title')}</span>
      </div>

      <div className="screen-body">
        {receivedId ? (
          <>
            <div className="orders-section-title">{t('delivery.done')}</div>
            <p className="field-hint">{t('delivery.doneHint')}</p>
            <button className="btn btn-secondary btn-block" onClick={() => { setText(''); setXlsx(null); onReset(); }}>
              {t('delivery.another')}
            </button>
          </>
        ) : (
          <>
            <p className="field-hint">{t('delivery.intro')}</p>

            {!match && (
              <>
                <div className="form-field">
                  <label htmlFor="delivery-file">{t('import.file')}</label>
                  <input
                    id="delivery-file"
                    type="file"
                    accept=".xlsx,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => loadFile(e.target.files?.[0])}
                  />
                  {xlsx && <span className="field-hint">{t('import.chosen', { name: xlsx.name })}</span>}
                </div>

                <div className="form-field">
                  <label htmlFor="delivery-text">{t('import.orPaste')}</label>
                  <textarea id="delivery-text" rows={6} value={text} onChange={(e) => { setText(e.target.value); onReset(); }} />
                </div>

                <button className="btn btn-primary btn-block" disabled={!source || loading} onClick={() => source && onMatch(source)}>
                  {loading ? t('delivery.matching') : t('delivery.match')}
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
                    <div className="report-card low">
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
                </div>

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

                <p className="field-hint">{t('delivery.check')}</p>

                <div className="orders-section-title">{t('priceList.lines', { count: match.lines.length })}</div>

                {match.lines.map((line) => (
                  <div key={line.line} className="report-row">
                    <span>
                      {line.ourName ?? line.supplierName}
                      <br />
                      <span className="order-meta">
                        {formatMoney(line.receiptPrice)}
                        {line.priceChangePercent !== null && (
                          <span className={line.priceChangePercent > 0 ? 'price-up' : 'price-down'}>
                            {' '}{line.priceChangePercent > 0 ? '+' : ''}{line.priceChangePercent} %
                          </span>
                        )}
                        {line.quantity === null ? ` · ${t('delivery.noQuantity')}` : ''}
                      </span>
                    </span>

                    {line.productId ? (
                      <input
                        className="qty-input"
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
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
                  onClick={() => onReceive(chosen)}
                >
                  {submitting
                    ? t('common.saving')
                    : t('delivery.receive', { count: chosen.length, total: formatMoney(total) })}
                </button>
                <p className="order-meta">{t('delivery.whatGoesIn')}</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
