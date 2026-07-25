import type { Company } from '../types';
import { SUPPORT_LABELS } from '../types';
import { StatusChip } from './StatusChip';
import { ModuleBadges } from './ModuleBadges';
import { formatDate, getTariffState } from '../utils';

export function CompaniesTable({ companies, onSelect }: { companies: Company[]; onSelect: (id: string) => void }) {
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
                <div className="company-bin">{c.phone}</div>
              </td>
              <td>{c.locations.length}</td>
              <td><ModuleBadges modules={c.tariff.modules} /></td>
              <td>{SUPPORT_LABELS[c.tariff.supportLevel]}</td>
              <td><StatusChip state={getTariffState(c.tariff)} /></td>
              <td className="date-cell">{formatDate(c.tariff.validUntil)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
