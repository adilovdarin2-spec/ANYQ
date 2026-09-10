import { pluralPhrase } from '../i18n';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  tariff: { validUntil: string; daysLeft: number } | null | undefined;
  /**
   * Показывать только когда счёт пошёл на часы.
   *
   * За неделю до конца полоска говорится один раз — на открытии смены, то есть
   * утром, когда владелец рядом и ещё можно успеть. Висеть неделю поверх каждого
   * экрана она не должна: предупреждение, которое человек видит сто раз и сто раз
   * ничего не делает, он перестаёт видеть, и в последний день оно уже не
   * сработает. В последние сутки — наоборот, висит везде.
   */
  urgentOnly?: boolean;
}

/** За сколько дней начинаем говорить. */
const WARN_FROM_DAYS = 7;

/** «2026-09-15» → «15.09.2026»: дату читает продавец, а не программа. */
function asLocalDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return day && month && year ? `${day}.${month}.${year}` : iso;
}

/**
 * «Тариф заканчивается» — сказанное до того, как он закончился.
 *
 * Без этой полоски тариф кончается так: в восемь утра кассир прикладывает
 * палец, получает «обратитесь в поддержку», за ним очередь. Ни кассир, ни
 * очередь ничего сделать не могут — а владелец за неделю мог бы. Молчать до
 * отказа значит переложить свою забывчивость на чужой рабочий день.
 *
 * Видно всем, кто за кассой, а не только владельцу. Продлить может он, но
 * заметить полоску и позвонить ему может кассир, а цена ошибки — закрытый
 * магазин, и она выше, чем неловкость от того, что кассир видел дату оплаты.
 *
 * Исчезает, когда говорить не о чем: полоска, висящая всегда, перестаёт быть
 * предупреждением и становится частью фона.
 */
export function TariffNotice({ tariff, urgentOnly = false }: Props) {
  const { t } = useTranslation();
  // Сессия, сохранённая прошлой сборкой, про тариф не знает — это не повод
  // падать, это повод промолчать до следующего входа.
  if (!tariff) return null;
  if (tariff.daysLeft > WARN_FROM_DAYS || tariff.daysLeft < 0) return null;
  if (urgentOnly && tariff.daysLeft > 1) return null;

  const text =
    tariff.daysLeft === 0
      ? t('tariff.lastDay')
      : tariff.daysLeft === 1
        ? t('tariff.tomorrow')
        : t(pluralPhrase(tariff.daysLeft, 'tariff.daysOne', 'tariff.daysFew', 'tariff.daysMany'), {
            count: tariff.daysLeft,
            date: asLocalDate(tariff.validUntil),
          });

  // Последние два дня — красным, раньше — спокойным: предупреждение, которое
  // всегда тревожное, ничему не учит.
  const urgent = tariff.daysLeft <= 1;

  return (
    <div className={urgent ? 'tariff-notice urgent' : 'tariff-notice'} role="status">
      <strong>{text}</strong>
      <span>{t('tariff.what')}</span>
    </div>
  );
}
