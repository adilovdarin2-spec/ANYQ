import type { Company } from '../types';
import { SUPPORT_LABELS } from '../types';
import { StatusChip } from './StatusChip';
import { ModuleBadges } from './ModuleBadges';
import { EXPIRING_SOON_DAYS, daysUntil, formatDate, getTariffState, pluralizeRu, formatPhone } from '../utils';

/**
 * «Кончается через N дней» рядом с датой.
 *
 * Дата сама по себе не отвечает на вопрос, ради которого в этот список заходят:
 * кому выставлять счёт сейчас. Считать дни глазами по таблице из сорока строк
 * никто не будет, а цена пропущенной строки — магазин, который утром не
 * открылся.
 *
 * Молчит, когда до конца далеко: пометка у каждой строки перестаёт быть
 * пометкой.
 */
function ExpiringSoon({ validUntil }: { validUntil: string }) {
  const left = daysUntil(validUntil);
  if (left < 0 || left > EXPIRING_SOON_DAYS) return null;
  const text =
    left === 0 ? 'сегодня последний день' : `через ${left} ${pluralizeRu(left, 'день', 'дня', 'дней')}`;
  return <span className="expiring-soon">{text}</span>;
}

export function CompaniesTable({ companies, onSelect }: { companies: Company[]; onSelect: (id: string) => void }) {
  if (companies.length === 0) {
    return <div className="table-card empty-state">Пока нет ни одной компании — создайте первую кнопкой выше</div>;
  }

  return (
    <div className="table-card">
      <table>
        <thead>
          <tr>
            <th>Компания</th>
            <th>Точки</th>
            <th>Модули</th>
            <th>Поддержка</th>
            <th>Статус</th>
            <th>Действует до</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr
              key={c.id}
              tabIndex={0}
              role="button"
              aria-label={`Открыть карточку компании ${c.name}`}
              onClick={() => onSelect(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(c.id);
                }
              }}
            >
              <td>
                <div className="company-name">{c.name}</div>
                <div className="company-bin">{formatPhone(c.phone)}</div>
              </td>
              <td>{c.locations.length}</td>
              <td><ModuleBadges modules={c.tariff.modules} /></td>
              <td>{SUPPORT_LABELS[c.tariff.supportLevel]}</td>
              <td><StatusChip state={getTariffState(c.tariff)} /></td>
              <td className="date-cell">
                {formatDate(c.tariff.validUntil)}
                <ExpiringSoon validUntil={c.tariff.validUntil} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="companies-list-mobile">
        {companies.map((c) => (
          <button key={c.id} type="button" className="company-card" onClick={() => onSelect(c.id)}>
            <div className="company-card-head">
              <div>
                <div className="company-name">{c.name}</div>
                <div className="company-bin">{formatPhone(c.phone)}</div>
              </div>
              <StatusChip state={getTariffState(c.tariff)} />
            </div>
            <div className="company-card-modules">
              <ModuleBadges modules={c.tariff.modules} />
            </div>
            <div className="company-card-meta">
              <span>{c.locations.length} {pluralizeRu(c.locations.length, 'точка', 'точки', 'точек')}</span>
              <span>{SUPPORT_LABELS[c.tariff.supportLevel]}</span>
              <span>
                до {formatDate(c.tariff.validUntil)} <ExpiringSoon validUntil={c.tariff.validUntil} />
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
