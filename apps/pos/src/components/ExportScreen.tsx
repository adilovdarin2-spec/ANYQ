import { useState } from 'react';

interface Props {
  onBack: () => void;
  onExport: (dataset: string) => Promise<void>;
}

const DATASETS: { key: string; label: string; hint: string }[] = [
  { key: 'products', label: 'Товары', hint: 'Каталог с ценами закупки и продажи' },
  { key: 'stock', label: 'Остатки', hint: 'Что и где лежит на этой точке, включая не размещённое' },
  { key: 'sales', label: 'Продажи', hint: 'По строкам, а не по чекам — за 90 дней' },
  { key: 'movements', label: 'Движения товара', hint: 'Журнал с причиной и автором — за 90 дней' },
  { key: 'counterparties', label: 'Контрагенты', hint: 'Покупатели и поставщики с условиями долга' },
];

/**
 * Taking the data out.
 *
 * A shop that cannot get its numbers out of a system does not really own them,
 * and an owner deciding whether to trust a pilot with a year of trading asks
 * this early. It is also the answer to half the requests that would otherwise
 * arrive as "add a column to that report".
 */
export function ExportScreen({ onBack, onExport }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dataset: string) {
    setBusy(dataset);
    setError(null);
    try {
      await onExport(dataset);
    } catch {
      setError('Не удалось выгрузить. Проверьте связь и попробуйте ещё раз.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label="Назад">←</button>
        <span className="screen-title">Выгрузка данных</span>
      </div>

      <div className="screen-body">
        {error && <div className="login-error">{error}</div>}
        <p className="field-hint">
          Файлы CSV — открываются в Excel и в 1С. Это ваши данные: забирайте их когда угодно и
          делайте с ними что угодно.
        </p>

        {DATASETS.map((dataset) => (
          <button
            key={dataset.key}
            type="button"
            className="profile-action"
            disabled={busy !== null}
            onClick={() => run(dataset.key)}
          >
            <span>
              {dataset.label}
              <br />
              <span className="order-meta">{dataset.hint}</span>
            </span>
            <span>{busy === dataset.key ? '…' : '↓'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
