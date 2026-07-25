import type { ModuleKey } from '../types';
import { MODULE_LABELS } from '../types';

export function ModuleBadges({ modules }: { modules: ModuleKey[] }) {
  return (
    <>
      {modules.map((m) => (
        <span key={m} className="module-badge">{MODULE_LABELS[m]}</span>
      ))}
    </>
  );
}
