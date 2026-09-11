import type { SourceSystemInfo } from '../types';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  systems: SourceSystemInfo[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onChoose: (system: SourceSystemInfo) => void;
}

/**
 * «Перенести товары» — первый шаг, на котором владелец называет свою программу.
 *
 * Возражение, из-за которого магазин не переходит, — не цена, а «у меня три
 * тысячи позиций уже забиты в той программе». Ответ на него не может быть
 * «скачайте наш шаблон и разложите по нашим колонкам»: это и есть та неделя
 * работы, которой человек не хочет. Поэтому здесь он делает ровно одно —
 * тыкает в свою программу, а сопоставление колонок берёт на себя сервер.
 *
 * Экран честно говорит, что путь к выгрузке в чужой программе мы не проверяли,
 * когда это так. Выдуманный путь по чужому меню хуже отсутствующего: владелец
 * пойдёт искать пункт, которого нет, и решит, что вся система такая же.
 */
export function MigrationScreen({ systems, loading, error, onBack, onChoose }: Props) {
  const { t, s } = useTranslation();

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="icon-btn" onClick={onBack} aria-label={t('common.back')}>←</button>
        <span className="screen-title">{t('migrate.title')}</span>
      </div>

      <div className="screen-body">
        <p className="field-hint">{t('migrate.intro')}</p>

        {loading && <p className="field-hint">{t('common.loading')}</p>}
        {error && <p className="login-error">{error}</p>}

        <div className="migrate-tiles">
          {systems.map((system) => (
            <button key={system.id} className="migrate-tile" onClick={() => onChoose(system)}>
              {/* Через тот же словарь, что и описание. Названия программ — это
                  марки, и словарь их не знает, поэтому они проходят насквозь;
                  а единственная не-марка в списке, «Excel или другая», перевод
                  имеет и раньше оставалась русской посреди казахского экрана. */}
              <span className="migrate-tile-name">{s(system.name)}</span>
              <span className="migrate-tile-note">{s(system.note)}</span>
            </button>
          ))}
        </div>

        <p className="field-hint">{t('migrate.whatMoves')}</p>
        <p className="order-meta">{t('migrate.whatStays')}</p>
      </div>
    </div>
  );
}

/**
 * Шаги для выбранной программы — показываются над файловым полем.
 *
 * Отдельным маленьким компонентом, потому что живёт он на экране импорта, а
 * знание о программе приходит отсюда.
 */
export function MigrationSteps({
  system,
  onChange,
}: {
  system: SourceSystemInfo;
  onChange: () => void;
}) {
  const { t, s } = useTranslation();

  return (
    <div className="migrate-steps">
      <div className="migrate-steps-head">
        <span className="migrate-steps-title">{t('migrate.stepsFor', { name: s(system.name) })}</span>
        <button className="link-button" onClick={onChange}>
          {t('migrate.change')}
        </button>
      </div>
      <ol className="migrate-steps-list">
        {system.steps.map((step, index) => (
          <li key={index}>{s(step)}</li>
        ))}
      </ol>
      {!system.stepsVerified && <p className="order-meta">{t('migrate.stepsUnverified')}</p>}
    </div>
  );
}
