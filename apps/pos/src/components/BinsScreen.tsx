import { useState } from 'react';
import type { BinContent, StorageBin } from '../types';

interface Props {
  bins: StorageBin[];
  unplaced: BinContent[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  canManage: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onCreateBin: (address: { zone: string; rack: string; shelf: string; bin: string }) => Promise<boolean>;
  onDeleteBin: (binId: string) => void;
  onPutaway: (payload: { productId: string; quantity: number; fromBin: string; toBin: string }) => Promise<boolean>;
}

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function BinsScreen({
  bins,
  unplaced,
  loading,
  error,
  submitting,
  canManage,
  onBack,
  onRefresh,
  onCreateBin,
  onDeleteBin,
  onPutaway,
}: Props) {
  const [view, setView] = useState<'map' | 'new-bin'>('map');
  const [zone, setZone] = useState('');
  const [rack, setRack] = useState('');
  const [shelf, setShelf] = useState('');
  const [bin, setBin] = useState('');

  // The move being set up: which goods, out of which shelf. Started from
  // whichever row the storeman tapped, so the source is never mistyped.
  const [moving, setMoving] = useState<{ productId: string; name: string; fromBin: string; max: number } | null>(null);
  const [moveQuantity, setMoveQuantity] = useState('');
  const [moveTarget, setMoveTarget] = useState('');

  const zones = [...new Set(bins.map((b) => b.zone))].sort();

  async function createBin() {
    const created = await onCreateBin({ zone: zone.trim(), rack: rack.trim(), shelf: shelf.trim(), bin: bin.trim() });
    if (created) {
      setRack('');
      setShelf('');
      setBin('');
      setView('map');
    }
  }

  async function confirmMove() {
    if (!moving) return;
    const quantity = Number(moveQuantity);
    if (!(quantity > 0)) return;
    const done = await onPutaway({
      productId: moving.productId,
      quantity,
      fromBin: moving.fromBin,
      toBin: moveTarget,
    });
    if (done) {
      setMoving(null);
      setMoveQuantity('');
    }
  }

  function startMove(content: BinContent, fromBin: string) {
    setMoving({ productId: content.productId, name: content.name, fromBin, max: content.available });
    setMoveQuantity(String(content.available));
    setMoveTarget(bins.find((b) => b.code !== fromBin)?.code ?? '');
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={view === 'new-bin' ? () => setView('map') : onBack} aria-label="Назад">←</button>
        <span className="screen-title">Ячейки</span>
        {view === 'map' && canManage ? (
          <button className="icon-btn" onClick={() => setView('new-bin')} aria-label="Новая ячейка" style={{ marginLeft: 'auto' }}>+</button>
        ) : (
          <button className="icon-btn" onClick={onRefresh} aria-label="Обновить" style={{ marginLeft: 'auto' }}>⟳</button>
        )}
      </div>

      {view === 'map' && (
        <div className="screen-body">
          {error && <div className="login-error">{error}</div>}
          {loading && bins.length === 0 && unplaced.length === 0 && <div className="empty-state">Загрузка…</div>}

          {/* Not a bin, and deliberately first: goods that arrived and were
              never put away are the pile a warehouse most needs to see. */}
          {unplaced.length > 0 && (
            <>
              <div className="orders-section-title">Не размещено</div>
              {unplaced.map((content) => (
                <div key={content.productId} className="report-row">
                  <span>
                    {content.name}
                    <br />
                    <span className="order-meta">{formatQuantity(content.quantity)} на точке</span>
                  </span>
                  <button className="li-remove" onClick={() => startMove(content, '')}>Разместить</button>
                </div>
              ))}
            </>
          )}

          {zones.map((zoneName) => (
            <div key={zoneName}>
              <div className="orders-section-title">Зона {zoneName}</div>
              {bins
                .filter((b) => b.zone === zoneName)
                .map((b) => (
                  <div key={b.id} className="order-card">
                    <div className="order-card-head">
                      <div>
                        <div className="order-customer">{b.code}</div>
                        <div className="order-meta">
                          {b.contents.length === 0 ? 'пусто' : `позиций: ${b.contents.length}`}
                        </div>
                      </div>
                      {canManage && b.contents.length === 0 && (
                        <button className="li-remove" onClick={() => onDeleteBin(b.id)}>Удалить</button>
                      )}
                    </div>
                    {b.contents.length > 0 && (
                      <div className="order-items">
                        {b.contents.map((content) => (
                          <div key={content.productId} className="order-item-row">
                            <span>{content.name}</span>
                            <span>
                              {formatQuantity(content.quantity)}
                              {content.available !== content.quantity
                                ? ` (свободно ${formatQuantity(content.available)})`
                                : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {b.contents.map((content) => (
                      <button key={`move-${content.productId}`} className="btn btn-ghost btn-block" onClick={() => startMove(content, b.code)}>
                        Переместить: {content.name}
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          ))}

          {!loading && bins.length === 0 && (
            <div className="empty-state">
              Ячеек пока нет. Добавьте хотя бы одну зону — и товар можно будет размещать по адресам.
            </div>
          )}

          {moving && (
            <div className="order-card">
              <div className="order-card-head">
                <div>
                  <div className="order-customer">{moving.name}</div>
                  <div className="order-meta">
                    из {moving.fromBin || 'не размещённых'} · свободно {formatQuantity(moving.max)}
                  </div>
                </div>
              </div>
              <div className="transfer-add-row">
                <input
                  type="number"
                  min="0"
                  step="any"
                  max={moving.max}
                  value={moveQuantity}
                  onChange={(e) => setMoveQuantity(e.target.value)}
                  aria-label="Сколько переместить"
                />
                <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} aria-label="Куда">
                  {bins
                    .filter((b) => b.code !== moving.fromBin)
                    .map((b) => (
                      <option key={b.id} value={b.code}>{b.code}</option>
                    ))}
                </select>
                <button type="button" className="btn btn-secondary" disabled={submitting || !moveTarget} onClick={confirmMove}>
                  {submitting ? 'Перемещаем…' : 'Разместить'}
                </button>
              </div>
              <button className="btn btn-ghost btn-block" onClick={() => setMoving(null)}>Отмена</button>
            </div>
          )}
        </div>
      )}

      {view === 'new-bin' && (
        <>
          <div className="screen-body">
            <p className="field-hint">
              Адрес пишется так, как он написан на стеллаже: зона, стеллаж, полка, ячейка.
              Лишние уровни можно не заполнять — «Склад» это тоже адрес. Пропускать уровни нельзя:
              «полка 3» без стеллажа — не то место, куда можно кого-то отправить.
            </p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="bin-zone">Зона</label>
                <input id="bin-zone" type="text" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="A" />
              </div>
              <div className="field">
                <label htmlFor="bin-rack">Стеллаж</label>
                <input id="bin-rack" type="text" value={rack} onChange={(e) => setRack(e.target.value)} placeholder="02" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="bin-shelf">Полка</label>
                <input id="bin-shelf" type="text" value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="03" />
              </div>
              <div className="field">
                <label htmlFor="bin-cell">Ячейка</label>
                <input id="bin-cell" type="text" value={bin} onChange={(e) => setBin(e.target.value)} placeholder="04" />
              </div>
            </div>
            {error && <div className="login-error">{error}</div>}
          </div>
          <div className="screen-footer">
            <button className="btn btn-primary btn-block" disabled={zone.trim() === '' || submitting} onClick={createBin}>
              {submitting ? 'Создаём…' : 'Создать ячейку'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
