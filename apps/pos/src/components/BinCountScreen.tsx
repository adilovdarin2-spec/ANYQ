import { useState } from 'react';
import type { CountSheetLine, StorageBin } from '../types';

interface Props {
  bins: StorageBin[];
  sheet: { bin: string; lines: CountSheetLine[] } | null;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  lastResult: { binLocation: string; name: string; systemQuantity: number; countedQuantity: number; delta: number }[] | null;
  onBack: () => void;
  onOpenBin: (bin: string) => void;
  onSubmit: (bin: string, lines: { productId: string; countedQuantity: number }[]) => Promise<boolean>;
  onClearResult: () => void;
}

const UNPLACED = '';

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function BinCountScreen({
  bins,
  sheet,
  loading,
  error,
  submitting,
  lastResult,
  onBack,
  onOpenBin,
  onSubmit,
  onClearResult,
}: Props) {
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
      countedQuantity: Number(counted[line.productId] ?? '0') || 0,
    }));
    const done = await onSubmit(sheet.bin, lines);
    if (done) setCounted({});
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={sheet ? () => onOpenBin('__none__') : onBack} aria-label="Назад">←</button>
        <span className="screen-title">Пересчёт по ячейкам</span>
      </div>

      {!sheet && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          <p className="field-hint">
            Пересчитывается вся ячейка целиком: чего в ней не нашли — того в ней нет. Поэтому можно
            считать по одному стеллажу в день, не закрывая магазин.
          </p>

          {lastResult && (
            <>
              <div className="orders-section-title">Итог последнего пересчёта</div>
              {lastResult.length === 0 ? (
                <div className="empty-state">Расхождений нет — ячейка сошлась</div>
              ) : (
                lastResult.map((line, index) => (
                  <div key={`${line.binLocation}-${line.name}-${index}`} className="report-row low">
                    <span>
                      {line.name}
                      <br />
                      <span className="order-meta">
                        {line.binLocation || 'не размещено'} · было {formatQuantity(line.systemQuantity)},
                        насчитали {formatQuantity(line.countedQuantity)}
                      </span>
                    </span>
                    <span>{line.delta > 0 ? `+${formatQuantity(line.delta)}` : formatQuantity(line.delta)}</span>
                  </div>
                ))
              )}
            </>
          )}

          <div className="orders-section-title">Выберите ячейку</div>
          <button className="btn btn-secondary btn-block" onClick={() => openBin(UNPLACED)}>
            Не размещённый товар
          </button>
          {bins.map((bin) => (
            <button key={bin.id} className="btn btn-secondary btn-block" onClick={() => openBin(bin.code)}>
              {bin.code}
            </button>
          ))}
          {bins.length === 0 && (
            <div className="empty-state">Ячеек нет — заведите их в разделе «Ячейки»</div>
          )}
        </div>
      )}

      {sheet && (
        <>
          <div className="screen-body">
            <div className="count-hint">
              {sheet.bin || 'Не размещённый товар'} — впишите, сколько нашли. Пустая строка означает
              «не нашли», и это тоже результат.
            </div>

            {loading && <div className="empty-state">Загрузка…</div>}
            {!loading && sheet.lines.length === 0 && <div className="empty-state">Система считает эту ячейку пустой</div>}

            {sheet.lines.map((line) => (
              <div key={line.productId} className="count-row">
                <div>
                  <div className="li-name">{line.name}</div>
                  {/* The system figure is shown but never prefilled: a filled
                      box turns a count into a confirmation, and a confirmation
                      finds nothing. */}
                  <div className="li-price">
                    система: {formatQuantity(line.systemQuantity)}
                    {line.reserved > 0 ? ` · ${formatQuantity(line.reserved)} под заказ` : ''}
                    {line.blocked > 0 ? ` · ${formatQuantity(line.blocked)} в карантине` : ''}
                  </div>
                </div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={counted[line.productId] ?? ''}
                  onChange={(e) => setCounted((prev) => ({ ...prev, [line.productId]: e.target.value }))}
                  aria-label={`Насчитано: ${line.name}`}
                />
              </div>
            ))}

            {error && <div className="login-error">{error}</div>}
          </div>

          <div className="screen-footer">
            <button className="btn btn-primary btn-block" disabled={submitting} onClick={submit}>
              {submitting ? 'Сохраняем…' : 'Закрыть ячейку'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
