import { useState } from 'react';
import type { DrawerEntry, Sale, Shift } from '../types';
import type { ServerDrawer } from '../shift-tally';
import { formatMoney, formatTime } from '../utils';
import { useTranslation } from '../i18n/useLanguage';
import { drawerAddsUp, drawerFigures, refusedInShift, tallyShift } from '../shift-tally';

interface Props {
  shift: Shift;
  sales: Sale[];
  /** Движения наличных мимо чека за эту смену: возвраты и расчёты. */
  drawer: DrawerEntry[];
  /**
   * Что насчитал по этому ящику сервер, если до него удалось дозвониться.
   *
   * `null` — не удалось, и тогда показывается свой счёт. Разница между этими
   * двумя счетами — не ошибка кассы: своё устройство знает только свои чеки, а
   * долг, принятый на соседней кассе, ложится в тот же ящик.
   */
  serverCash: ServerDrawer | null;
  onCancel: () => void;
  onConfirm: (closingCashCounted: number) => void;
}

export function CloseShiftScreen({ shift, sales, drawer, serverCash, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');

  const local = tallyShift(sales, shift.openingCash, drawer);
  const { byMethod, total } = local;
  // Все строки ящика — из одного источника: серверного, если дозвонились, и
  // своего, если нет. Половина оттуда, половина отсюда даёт столбец, который
  // не складывается, а это хуже, чем посчитать по-своему.
  const figures = drawerFigures(local, serverCash, sales);
  const { cash, refundedCash, settledIn, settledOut, expectedCash, fromServer } = figures;
  const addsUp = drawerAddsUp(figures, shift.openingCash);
  // Их деньги в ящике есть, а в Z-отчёте на сервере не будет. Сказать об этом
  // нужно здесь — на этом экране человек последний раз смотрит на смену.
  const refused = refusedInShift(sales);
  const refusedSum = refused.reduce((sum, s) => sum + s.total, 0);

  const countedValue = counted === '' ? null : Number(counted);
  const diff = countedValue === null ? null : countedValue - expectedCash;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onCancel} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('shift.close.title')}</span>
      </div>
      <div className="screen-body">
        <div className="summary-row"><span className="sr-muted">{t('shift.close.openedAt')}</span><span>{formatTime(shift.openedAt)}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('shift.close.salesCount')}</span><span>{sales.length}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('payment.cash')}</span><span>{formatMoney(cash)}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('payment.kaspi')}</span><span>{formatMoney(byMethod.kaspi)}</span></div>
        <div className="summary-row"><span className="sr-muted">{t('payment.card')}</span><span>{formatMoney(byMethod.card)}</span></div>
        {/* Долг показываем, только когда он есть: в магазине, где в долг не
            отпускают, лишняя строка с нулём — это вопрос «а что это». */}
        {byMethod.credit > 0 && (
          <div className="summary-row"><span className="sr-muted">{t('payment.credit')}</span><span>{formatMoney(byMethod.credit)}</span></div>
        )}
        <div className="summary-row total"><span>{t('shift.close.total')}</span><span>{formatMoney(total)}</span></div>

        {/* Показываем, только когда возвращали: строка «0 ₸» в отчёте о смене
            заставляет искать, чего не было. */}
        {refundedCash > 0 && (
          <div className="summary-row">
            <span className="sr-muted">{t('shift.close.refundedCash')}</span>
            <span>{formatMoney(-refundedCash)}</span>
          </div>
        )}
        {/* Долги, погашенные наличными, и оплаты поставщикам из ящика. Каждая
            строка появляется, только если такое за смену было: в магазине, где
            в долг не торгуют, лишние нули — это вопрос «а что это». */}
        {settledIn > 0 && (
          <div className="summary-row">
            <span className="sr-muted">{t('shift.close.settledIn')}</span>
            <span>+{formatMoney(settledIn)}</span>
          </div>
        )}
        {settledOut > 0 && (
          <div className="summary-row">
            <span className="sr-muted">{t('shift.close.settledOut')}</span>
            <span>{formatMoney(-settledOut)}</span>
          </div>
        )}

        {/* Число, ради которого этот экран и открывают: с ним сравнивают то,
            что лежит в ящике. Оно стояло здесь тем же кеглем, что «Kaspi QR»
            строкой выше, — то есть ровно как справочная величина. */}
        <div className="summary-row expected-cash">
          <span className="sr-muted">{t('shift.close.expectedCash')}</span>
          <span>{formatMoney(expectedCash)}</span>
        </div>
        {/* Столбец, который не складывается в свой же итог.

            Проверка написана вместе с этим экраном и не звалась нигде, кроме
            тестов, — то есть охраняла сама себя. А ловит она ровно то, чем этот
            экран опасен: строки и итог приходят разными выражениями и разойтись
            могут тихо. Кассир сложит столбец в уме, не получит итога и решит,
            что обманывают его.

            Закрыть смену это не мешает: запереть человека с деньгами в ящике
            хуже любого неверного числа. */}
        {!addsUp && <p className="login-error">{t('shift.close.doesNotAddUp')}</p>}
        {/* Сказано, а не умолчано: кассир, у которого не сходится, должен
            знать, по чьим данным посчитано. Своё устройство видит только свои
            чеки — долг, принятый на соседней кассе, в нём не отражён. */}
        {!fromServer && (
          <p className="field-hint">{t('shift.close.countedHere')}</p>
        )}

        <div className="form-field" style={{ marginTop: 10 }}>
          <label htmlFor="counted-cash">{t('shift.close.countedCash')}</label>
          <input
            id="counted-cash"
            type="number"
            inputMode="numeric"
            min="0"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
        </div>

        {refused.length > 0 && (
          <div className="reconcile-diff short" style={{ marginTop: 12 }}>
            {t('shift.close.refused', { count: refused.length, amount: formatMoney(refusedSum) })}
          </div>
        )}

        {diff !== null && (
          <div className={`reconcile-diff ${diff === 0 ? 'ok' : diff < 0 ? 'short' : 'over'}`}>
            {diff === 0
              ? t('shift.close.matches')
              : diff < 0
                ? t('shift.close.short', { amount: formatMoney(Math.abs(diff)) })
                : t('shift.close.over', { amount: formatMoney(diff) })}
          </div>
        )}
      </div>
      <div className="screen-footer">
        <button className="btn btn-secondary btn-block" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          className="btn btn-primary btn-block"
          disabled={countedValue === null}
          onClick={() => countedValue !== null && onConfirm(countedValue)}
        >
          {t('shift.close.submit')}
        </button>
      </div>
    </div>
  );
}
