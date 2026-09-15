import { useTranslation } from '../i18n/useLanguage';

/**
 * Окно про конец тарифа, которое надо закрыть рукой.
 *
 * Появляется только в последние сутки и только раз в четыре часа. Полоска в
 * шапке к этому моменту висит уже неделю, и человек, видевший её сто раз и сто
 * раз ничего не сделавший, её больше не видит — это ровно тот механизм, из-за
 * которого предупреждения перестают работать именно тогда, когда нужны.
 *
 * Поэтому здесь не полоска, а остановка: чтобы вернуться к продаже, надо
 * нажать. Один раз в четыре часа — это два-три раза за смену, и цена этому —
 * закрытый назавтра магазин.
 *
 * Закрывается кнопкой и только ею. Ни щелчка мимо, ни Escape: и то и другое
 * срабатывает случайно у человека, который тянется к кнопке оплаты.
 */
interface Props {
  /** 0 — сегодня последний день, 1 — завтра. */
  daysLeft: number;
  /** «2026-09-15». */
  validUntil: string;
  onDismiss: () => void;
}

/** «2026-09-15» → «15.09.2026»: дату читает продавец, а не программа. */
function asLocalDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return day && month && year ? `${day}.${month}.${year}` : iso;
}

export function LicenceReminder({ daysLeft, validUntil, onDismiss }: Props) {
  const { t } = useTranslation();

  return (
    <div className="licence-reminder-backdrop" role="alertdialog" aria-modal="true">
      <div className="licence-reminder">
        <div className="licence-reminder-title">
          {daysLeft === 0 ? t('tariff.lastDay') : t('tariff.tomorrow')}
        </div>
        <div className="licence-reminder-body">
          {t('licence.remindBody', { date: asLocalDate(validUntil) })}
        </div>
        <button type="button" className="btn btn-primary licence-reminder-ok" onClick={onDismiss}>
          {t('licence.remindOk')}
        </button>
      </div>
    </div>
  );
}
