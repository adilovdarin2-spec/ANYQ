import { useState } from 'react';
import type { OpenShiftInfo, ShiftCash } from '../api';
import { formatDateTime, formatMoney } from '../utils';
import { useTranslation } from '../i18n/useLanguage';

/**
 * Закрыть смену, которую это устройство не открывало.
 *
 * Обычное закрытие считает ящик по своим записям: касса знает свои чеки, свои
 * возвраты, свой расчёт. Забытая смена — ровно тот случай, когда этих записей
 * нет: планшет поменяли, кассир уволился, смену открыли на второй кассе и
 * ушли. Всё, что о ней известно, знает сервер.
 *
 * Поэтому здесь отдельный экран, а не тот же с пустыми массивами. Тот показал
 * бы «Продаж за смену 0», «Kaspi 0 ₸», «Карта 0 ₸» — числа, которых никто не
 * считал, рядом с ожидаемой суммой, посчитанной честно. Человек закрывает
 * смену по столбцу цифр; столбец, наполовину состоящий из нулей по незнанию,
 * хуже, чем его отсутствие.
 *
 * Пересчитанная сумма не подставляется. Подставить ожидаемую значило бы
 * оформить сошедшуюся сверку за день, который никто не сверял, — и недостача
 * того дня оказалась бы заверена этой же записью. Число вводит человек, и он
 * видит, что из него выйдет, до того как нажмёт.
 */

interface Props {
  shift: OpenShiftInfo;
  /** Что сервер насчитал по этому ящику. null — пока идёт запрос. */
  cash: ShiftCash | null;
  /** Сервер не ответил: закрыть вслепую нельзя, и это нужно сказать словами. */
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (closingCashCounted: number) => void;
}

export function CloseForgottenShiftScreen({ shift, cash, error, busy, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');

  const countedValue = counted === '' ? null : Number(counted);
  const valid = countedValue !== null && Number.isFinite(countedValue) && countedValue >= 0 && !!cash && !busy;
  const diff = countedValue !== null && cash ? countedValue - cash.expected : null;

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onCancel} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('shift.forgotten.title')}</span>
      </div>
      <div className="screen-body">
        <div className="summary-row">
          <span className="sr-muted">{t('shift.forgotten.cashier')}</span>
          <span>{shift.cashierName}</span>
        </div>
        <div className="summary-row">
          <span className="sr-muted">{t('shift.close.openedAt')}</span>
          <span>{formatDateTime(shift.openedAt)}</span>
        </div>

        {/* Почему экран вообще другой. Кассир, закрывающий свою смену вечером,
            этого не читает — а тот, кто закрывает позавчерашнюю, должен
            понимать, что сходиться ей не обязано. */}
        <p className="field-hint">{t('shift.forgotten.why')}</p>

        {error && <div className="login-error">{error}</div>}

        {/* Числа только серверные — и только те, что сервер для этого запроса
            действительно считает: наличную сторону ящика. Количество чеков и
            разбивку по картам он не возвращает, и придумывать их незачем. */}
        {cash && (
          <>
            <div className="summary-row">
              <span className="sr-muted">{t('shift.forgotten.openingCash')}</span>
              <span>{formatMoney(cash.openingCash)}</span>
            </div>
            <div className="summary-row">
              <span className="sr-muted">{t('shift.forgotten.takings')}</span>
              <span>{formatMoney(cash.takings)}</span>
            </div>
            {cash.refunded > 0 && (
              <div className="summary-row">
                <span className="sr-muted">{t('shift.close.refundedCash')}</span>
                <span>{formatMoney(-cash.refunded)}</span>
              </div>
            )}
            {cash.settledIn > 0 && (
              <div className="summary-row">
                <span className="sr-muted">{t('shift.close.settledIn')}</span>
                <span>+{formatMoney(cash.settledIn)}</span>
              </div>
            )}
            {cash.settledOut > 0 && (
              <div className="summary-row">
                <span className="sr-muted">{t('shift.close.settledOut')}</span>
                <span>{formatMoney(-cash.settledOut)}</span>
              </div>
            )}
            <div className="summary-row expected-cash">
              <span className="sr-muted">{t('shift.close.expectedCash')}</span>
              <span>{formatMoney(cash.expected)}</span>
            </div>
          </>
        )}

        <div className="form-field" style={{ marginTop: 10 }}>
          <label htmlFor="forgotten-counted">{t('shift.close.countedCash')}</label>
          <input
            id="forgotten-counted"
            type="number"
            inputMode="numeric"
            min="0"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
          <p className="field-hint">{t('shift.forgotten.countedWhy')}</p>
        </div>

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
          disabled={!valid}
          onClick={() => countedValue !== null && onConfirm(countedValue)}
        >
          {busy ? t('shift.forgotten.closing') : t('shift.forgotten.submit')}
        </button>
      </div>
    </div>
  );
}
