import { useState } from 'react';
import type { ImportPreview } from '../types';
import { parseSheet } from '../utils';

interface Props {
  preview: ImportPreview | null;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  result: { created: number; updated: number; stocked: number; skipped: number } | null;
  onBack: () => void;
  onPreview: (grid: string[][]) => void;
  onCommit: (grid: string[][]) => void;
  onReset: () => void;
}

export function ImportScreen({
  preview,
  loading,
  error,
  submitting,
  result,
  onBack,
  onPreview,
  onCommit,
  onReset,
}: Props) {
  const [text, setText] = useState('');
  const grid = text.trim() ? parseSheet(text) : [];

  function loadFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      onReset();
    };
    // Excel on Windows still saves CSV in the system codepage more often than
    // not, but UTF-8 is what a modern export gives and what a paste always is.
    // A file that comes out as gibberish is visible immediately in the preview,
    // which is better than a silent mis-import.
    reader.readAsText(file, 'utf-8');
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Импорт товаров</span>
      </div>

      <div className="screen-body">
        {result ? (
          <>
            <div className="report-cards">
              <div className="report-card">
                <span className="value">{result.created}</span>
                <span className="label">Добавлено</span>
              </div>
              <div className="report-card">
                <span className="value">{result.updated}</span>
                <span className="label">Обновлено</span>
              </div>
              {result.stocked > 0 && (
                <div className="report-card">
                  <span className="value">{result.stocked}</span>
                  <span className="label">С остатком</span>
                </div>
              )}
              {result.skipped > 0 && (
                <div className="report-card">
                  <span className="value">{result.skipped}</span>
                  <span className="label">Пропущено</span>
                </div>
              )}
            </div>
            <button className="btn btn-secondary btn-block" onClick={() => { setText(''); onReset(); }}>
              Импортировать ещё
            </button>
          </>
        ) : (
          <>
            <p className="field-hint">
              Откройте свой файл в Excel, выделите таблицу вместе с заголовками, скопируйте и
              вставьте сюда. Или выберите сохранённый CSV. Заголовки могут называться как у вас —
              «Наименование», «Товар», «Цена продажи»: система разберётся.
            </p>

            <div className="form-field">
              <label htmlFor="import-file">Файл CSV</label>
              <input id="import-file" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => loadFile(e.target.files?.[0])} />
            </div>

            <div className="form-field">
              <label htmlFor="import-text">Или вставьте из Excel</label>
              <textarea
                id="import-text"
                rows={8}
                value={text}
                onChange={(e) => { setText(e.target.value); onReset(); }}
                placeholder={'Наименование\tЦена\tОстаток\nВода 1 л\t250\t40'}
              />
            </div>

            {grid.length > 0 && (
              <p className="order-meta">
                Распознано строк: {grid.length} (включая заголовок), столбцов: {grid[0]?.length ?? 0}
              </p>
            )}

            {error && <div className="login-error">{error}</div>}

            {/* Nothing is written until this has been seen. An import that
                applies rows until it hits a bad one leaves a catalogue half in
                and half not, with no way to tell which. */}
            {preview && (
              <>
                <div className="orders-section-title">Что произойдёт</div>
                <div className="report-cards">
                  <div className="report-card">
                    <span className="value">{preview.created}</span>
                    <span className="label">Будет добавлено</span>
                  </div>
                  <div className="report-card">
                    <span className="value">{preview.updated}</span>
                    <span className="label">Будет обновлено</span>
                  </div>
                  {preview.skipped > 0 && (
                    <div className="report-card">
                      <span className="value">{preview.skipped}</span>
                      <span className="label">Пропущено</span>
                    </div>
                  )}
                </div>

                {preview.sample.length > 0 && (
                  <>
                    <div className="orders-section-title">Первые строки</div>
                    {preview.sample.map((row) => (
                      <div key={row.line} className="report-row">
                        <span>
                          {row.name}
                          <br />
                          <span className="order-meta">
                            строка {row.line} · {row.salePrice} ₸
                            {row.quantity > 0 ? ` · остаток ${row.quantity}` : ''}
                            {row.existingProductId ? ' · уже есть, обновим' : ''}
                          </span>
                        </span>
                      </div>
                    ))}
                  </>
                )}

                {preview.problems.length > 0 && (
                  <>
                    <div className="orders-section-title">
                      Что не так ({preview.problemCount})
                    </div>
                    {/* Every problem carries the row number from the file the
                        person is looking at, because "ошибка импорта" is not
                        something anybody can act on. */}
                    {preview.problems.map((problem, index) => (
                      <div key={`${problem.line}-${index}`} className={problem.severity === 'error' ? 'report-row low' : 'report-row'}>
                        <span>
                          Строка {problem.line}
                          <br />
                          <span className="order-meta">{problem.message}</span>
                        </span>
                        <span className={problem.severity === 'error' ? 'pill warn' : 'pill'}>
                          {problem.severity === 'error' ? 'пропустим' : 'внимание'}
                        </span>
                      </div>
                    ))}
                  </>
                )}

                <p className="field-hint">
                  Остаток заводится только для новых товаров. Повторный импорт прайса не затрёт
                  то, что лежит на полке, — для исправления остатков есть инвентаризация.
                </p>
              </>
            )}
          </>
        )}
      </div>

      {!result && (
        <div className="screen-footer">
          {!preview ? (
            <button className="btn btn-primary btn-block" disabled={grid.length < 2 || loading} onClick={() => onPreview(grid)}>
              {loading ? 'Проверяем…' : 'Проверить файл'}
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary btn-block"
                disabled={submitting || preview.created + preview.updated === 0}
                onClick={() => onCommit(grid)}
              >
                {submitting ? 'Импортируем…' : `Импортировать ${preview.created + preview.updated}`}
              </button>
              <button className="btn btn-ghost btn-block" disabled={submitting} onClick={onReset}>
                Отмена
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
