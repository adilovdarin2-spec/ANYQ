import { useState } from 'react';
import type { ImportPreview, SourceSystemInfo } from '../types';
import type { ImportSource } from '../api';
import { useTranslation } from '../i18n/useLanguage';
import { parseSheet } from '../utils';
import { MigrationSteps } from './MigrationScreen';
import { CatalogueAnalysisPanel } from './CatalogueAnalysis';

interface Props {
  /** Программа, из которой переезжают. null — обычный импорт прайса. */
  system: SourceSystemInfo | null;
  onChangeSystem: () => void;
  preview: ImportPreview | null;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  result: { created: number; updated: number; stocked: number; skipped: number } | null;
  onBack: () => void;
  onPreview: (source: ImportSource) => void;
  onCommit: (source: ImportSource) => void;
  onReset: () => void;
}

export function ImportScreen({
  system,
  onChangeSystem,
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
  const { t } = useTranslation();
  const [text, setText] = useState('');
  // Set when an .xlsx was chosen. Kept apart from the pasted text rather than
  // converted into it, because the server reads the spreadsheet properly and a
  // client-side conversion would be a second, worse parser.
  const [xlsx, setXlsx] = useState<{ name: string; base64: string } | null>(null);
  const grid = text.trim() ? parseSheet(text) : [];
  const source: ImportSource | null = xlsx
    ? { xlsxBase64: xlsx.base64 }
    : grid.length > 0
      ? { grid }
      : null;

  function loadFile(file: File | undefined) {
    if (!file) return;
    onReset();

    // An .xlsx goes to the server as bytes. Excel's own format is a zip of XML
    // and reading it here would mean a second parser in the browser, worse than
    // the one the server already has.
    if (/\.xlsx$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        let binary = '';
        // In chunks: String.fromCharCode(...bytes) on a megabyte blows the
        // argument limit and throws.
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
    // Excel on Windows still saves CSV in the system codepage more often than
    // not, but UTF-8 is what a modern export gives and what a paste always is.
    // A file that comes out as gibberish is visible immediately in the preview,
    // which is better than a silent mis-import.
    reader.readAsText(file, 'utf-8');
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{system ? t('migrate.title') : t('import.title')}</span>
      </div>

      <div className="screen-body">
        {system && !result && <MigrationSteps system={system} onChange={onChangeSystem} />}
        {result ? (
          <>
            <div className="report-cards">
              <div className="report-card">
                <span className="value">{result.created}</span>
                <span className="label">{t('import.added')}</span>
              </div>
              <div className="report-card">
                <span className="value">{result.updated}</span>
                <span className="label">{t('import.updated')}</span>
              </div>
              {result.stocked > 0 && (
                <div className="report-card">
                  <span className="value">{result.stocked}</span>
                  <span className="label">{t('import.withStock')}</span>
                </div>
              )}
              {result.skipped > 0 && (
                <div className="report-card">
                  <span className="value">{result.skipped}</span>
                  <span className="label">{t('import.skipped')}</span>
                </div>
              )}
            </div>
            <button
              className="btn btn-secondary btn-block"
              onClick={() => { setText(''); setXlsx(null); onReset(); }}
            >
              {t('import.again')}
            </button>
          </>
        ) : (
          <>
            <p className="field-hint">
              {t('import.pasteHow')} {t('import.headersFree')}
            </p>

            <div className="form-field">
              <label htmlFor="import-file">{t('import.file')}</label>
              <input
                id="import-file"
                type="file"
                accept=".xlsx,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => loadFile(e.target.files?.[0])}
              />
              {xlsx && (
                <span className="field-hint">
                  {t('import.chosen', { name: xlsx.name })}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="import-text">{t('import.orPaste')}</label>
              <textarea
                id="import-text"
                rows={8}
                value={text}
                onChange={(e) => { setText(e.target.value); onReset(); }}
                placeholder={`${t('product.name')}\t${t('product.salePrice')}\t${t('common.left')}`}
              />
            </div>

            {grid.length > 0 && (
              <p className="order-meta">
                {t('import.recognised', { rows: grid.length, columns: grid[0]?.length ?? 0 })}
              </p>
            )}

            {error && <div className="login-error">{error}</div>}

            {/* Nothing is written until this has been seen. An import that
                applies rows until it hits a bad one leaves a catalogue half in
                and half not, with no way to tell which. */}
            {preview && (
              <>
                <CatalogueAnalysisPanel analysis={preview.analysis} />

                <div className="orders-section-title">{t('import.whatHappens')}</div>
                <div className="report-cards">
                  <div className="report-card">
                    <span className="value">{preview.created}</span>
                    <span className="label">{t('import.willAdd')}</span>
                  </div>
                  <div className="report-card">
                    <span className="value">{preview.updated}</span>
                    <span className="label">{t('import.willUpdate')}</span>
                  </div>
                  {preview.skipped > 0 && (
                    <div className="report-card">
                      <span className="value">{preview.skipped}</span>
                      <span className="label">{t('import.skipped')}</span>
                    </div>
                  )}
                </div>

                {preview.sample.length > 0 && (
                  <>
                    <div className="orders-section-title">{t('import.firstRows')}</div>
                    {preview.sample.map((row) => (
                      <div key={row.line} className="report-row">
                        <span>
                          {row.name}
                          <br />
                          <span className="order-meta">
                            {t('import.row', { number: row.line })} · {row.salePrice} ₸
                            {row.quantity > 0 ? ` · ${t('import.stock', { count: row.quantity })}` : ''}
                            {row.existingProductId ? ` · ${t('import.exists')}` : ''}
                          </span>
                        </span>
                      </div>
                    ))}
                  </>
                )}

                {preview.problems.length > 0 && (
                  <>
                    <div className="orders-section-title">
                      {t('import.problems', { count: preview.problemCount })}
                    </div>
                    {/* Every problem carries the row number from the file the
                        person is looking at, because "ошибка импорта" is not
                        something anybody can act on. */}
                    {preview.problems.map((problem, index) => (
                      <div key={`${problem.line}-${index}`} className={problem.severity === 'error' ? 'report-row low' : 'report-row'}>
                        <span>
                          {t('import.problemRow', { number: problem.line })}
                          <br />
                          <span className="order-meta">{problem.message}</span>
                        </span>
                        <span className={problem.severity === 'error' ? 'pill warn' : 'pill'}>
                          {problem.severity === 'error' ? t('import.willSkip') : t('import.attention')}
                        </span>
                      </div>
                    ))}
                  </>
                )}

                <p className="field-hint">
                  {t('import.stockOnlyNew')}
                </p>
              </>
            )}
          </>
        )}
      </div>

      {!result && (
        <div className="screen-footer">
          {!preview ? (
            <button
              className="btn btn-primary btn-block"
              // A chosen .xlsx is enough on its own; a pasted table needs a
              // header row and at least one line under it.
              disabled={source === null || (xlsx === null && grid.length < 2) || loading}
              onClick={() => source && onPreview(source)}
            >
              {loading ? t('import.checking') : t('import.check')}
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary btn-block"
                disabled={submitting || preview.created + preview.updated === 0}
                onClick={() => source && onCommit(source)}
              >
                {submitting ? t('import.importing') : t('import.import', { count: preview.created + preview.updated })}
              </button>
              <button className="btn btn-ghost btn-block" disabled={submitting} onClick={onReset}>
                {t('common.cancel')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
