import { useState } from 'react';
import type { CountSheetLine, HoldRelease, StorageBin } from '../types';
import { useTranslation } from '../i18n/useLanguage';
import { parseTyped } from '../typed-number';
import { withUnit } from '../unit-form';

interface Props {
  bins: StorageBin[];
  sheet: { bin: string; lines: CountSheetLine[] } | null;
  loading: boolean;
  /** Список ячеек ещё едет — это не то же, что «ячеек нет». */
  binsLoading: boolean;
  error: string | null;
  submitting: boolean;
  lastResult: { binLocation: string; name: string; unit: string; systemQuantity: number; countedQuantity: number; delta: number }[] | null;
  /** Что пересчёт снял с брони и карантина: держали больше, чем нашли. */
  holdsReleased: HoldRelease[];
  /** The shelf whose count is written down but has not yet reached the server. */
  queuedBin: string | null;
  /** When the sheet on screen was taken from the server, if it came from the device. */
  sheetCachedAt: string | null;
  onBack: () => void;
  onOpenBin: (bin: string) => void;
  onSubmit: (bin: string, lines: { productId: string; countedQuantity: number }[]) => Promise<boolean>;
  onClearResult: () => void;
}

const UNPLACED = '';

/* Единица рядом с числом — из `withUnit`. Лист присылал единицу с самого
   начала, а экран её не печатал: кладовщик видел «В системе: 10» и сам решал,
   мешков это или килограммов. На складе это мешки по 50 кг и ящики по 12 литров, и
   ошибка в одну единицу — это недостача на пятьдесят кило. */

export function BinCountScreen({
  bins,
  sheet,
  loading,
  binsLoading,
  error,
  submitting,
  lastResult,
  holdsReleased,
  queuedBin,
  sheetCachedAt,
  onBack,
  onOpenBin,
  onSubmit,
  onClearResult,
}: Props) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState<Record<string, string>>({});

  function openBin(bin: string) {
    setCounted({});
    onClearResult();
    onOpenBin(bin);
  }

  async function submit() {
    if (!sheet) return;
    // Every line on the sheet is sent, including the ones left blank: a blank
    // means the counter walked the shelf and did not find it, which is the
    // finding. Only lines that are genuinely unanswered would be dropped, and
    // there is no such thing here — the shelf was either counted or it wasn't.
    const lines = sheet.lines.map((line) => ({
      productId: line.productId,
      countedQuantity: parseTyped(counted[line.productId] ?? '0') || 0,
    }));
    const done = await onSubmit(sheet.bin, lines);
    if (done) setCounted({});
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={sheet ? () => onOpenBin('__none__') : onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('count.title')}</span>
      </div>

      {!sheet && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          <p className="field-hint">
            {t('count.whole')}
          </p>

          {queuedBin !== null && (
            // Deliberately not an empty discrepancy table: "no discrepancies"
            // and "we do not know yet" are different answers, and showing the
            // first for the second is how a storeman comes to trust a figure
            // nobody has checked.
            <div className="empty-state">
              {t('count.queued', { bin: queuedBin || t('count.unplacedShort') })}
            </div>
          )}

          {lastResult && (
            <>
              <div className="orders-section-title">{t('count.lastResult')}</div>
              {lastResult.length === 0 ? (
                <div className="empty-state">{t('count.agreed')}</div>
              ) : (
                lastResult.map((line, index) => (
                  <div key={`${line.binLocation}-${line.name}-${index}`} className="report-row low">
                    <span>
                      {line.name}
                      <br />
                      <span className="order-meta">
                        {line.binLocation || t('count.unplacedShort')} · {t('count.wasCounted', { system: withUnit(line.systemQuantity, line.unit), counted: withUnit(line.countedQuantity, line.unit) })}
                      </span>
                    </span>
                    <span>{line.delta > 0 ? `+${withUnit(line.delta, line.unit)}` : withUnit(line.delta, line.unit)}</span>
                  </div>
                ))
              )}
            </>
          )}

          {holdsReleased.length > 0 && (
            /* Снятое удержание — не служебная подробность. Держали то, чего нет:
               карантин на пропавшем товаре или бронь под заказ, который теперь не соберётся
               целиком. Если не сказать сейчас — узнают на выдаче. */
            <>
              <div className="orders-section-title">{t('count.holdsTitle')}</div>
              {holdsReleased.map((hold) => (
                <div key={`hold-${hold.productId}-${hold.binLocation}`} className="report-row low">
                  <span>
                    {hold.name}
                    {hold.binLocation ? ` · ${hold.binLocation}` : ''}
                    <br />
                    <span className="order-meta">
                      {hold.blocked > 0 && t('count.holdBlockedOff', { count: withUnit(hold.blocked, hold.unit) })}
                      {hold.blocked > 0 && hold.reserved > 0 ? ' ' : ''}
                      {hold.reserved > 0 && t('count.holdReservedOff', { count: withUnit(hold.reserved, hold.unit) })}
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}

          <div className="orders-section-title">{t('count.pickBin')}</div>
          <button className="btn btn-secondary btn-block" onClick={() => openBin(UNPLACED)}>
            {t('count.unplaced')}
          </button>
          {bins.map((bin) => (
            <button key={bin.id} className="btn btn-secondary btn-block" onClick={() => openBin(bin.code)}>
              {bin.code}
            </button>
          ))}
          {!binsLoading && bins.length === 0 && (
            /* Только когда список доехал. Пока он едет, здесь стояло «Ячеек нет —
               заведите их», и кладовщик шёл заводить то, что у него уже есть. На складе с
               плохим wi-fi эта секунда длинная. Тот же разбор, что у очереди выше:
               «нет» и «пока не знаем» — разные ответы. */
            <div className="empty-state">{t('count.noBins')}</div>
          )}
        </div>
      )}

      {sheet && (
        <>
          <div className="screen-body">
            <div className="count-hint">
              {sheet.bin || t('count.unplaced')} — {t('count.enterFound')}
            </div>

            {sheetCachedAt && (
              <div className="field-hint">
                {t('count.offlineSheet', { when: new Date(sheetCachedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) })}
              </div>
            )}

            {loading && <div className="empty-state">{t('common.loading')}</div>}
            {!loading && sheet.lines.length === 0 && <div className="empty-state">{t('count.systemSaysEmpty')}</div>}

            {sheet.lines.map((line) => (
              <div key={line.productId} className="count-row">
                <div>
                  <div className="li-name">{line.name}</div>
                  {/* The system figure is shown but never prefilled: a filled
                      box turns a count into a confirmation, and a confirmation
                      finds nothing. */}
                  <div className="li-price">
                    {t('count.system')}: {withUnit(line.systemQuantity, line.unit)}
                    {line.reserved > 0 ? ` · ${t('count.reservedFor', { count: withUnit(line.reserved, line.unit) })}` : ''}
                    {line.blocked > 0 ? ` · ${t('count.inQuarantine', { count: withUnit(line.blocked, line.unit) })}` : ''}
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={counted[line.productId] ?? ''}
                  onChange={(e) => setCounted((prev) => ({ ...prev, [line.productId]: e.target.value }))}
                  aria-label={t('count.lineLabel', { name: line.name })}
                />
              </div>
            ))}

            {error && <div className="login-error">{error}</div>}
          </div>

          <div className="screen-footer">
            <button className="btn btn-primary btn-block" disabled={submitting} onClick={submit}>
              {submitting ? t('common.saving') : t('count.close')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
