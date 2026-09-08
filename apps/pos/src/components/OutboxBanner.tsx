import { commandPhrase } from '../outbox';
import type { WarehouseCommand } from '../outbox';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  pending: number;
  blockedCommand: WarehouseCommand | null;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}

/**
 * What the warehouse queue is doing, said out loud.
 *
 * A queue nobody can see is a queue nobody trusts: the storeman who receives a
 * delivery on a dead connection has no way to tell a command that is waiting
 * from one that was lost, and will receive it a second time to be sure. The
 * count here is the whole reassurance, and it disappears when there is nothing
 * to say.
 */
export function OutboxBanner({ pending, blockedCommand, onRetry, onDiscard }: Props) {
  const { t } = useTranslation();
  if (!pending && !blockedCommand) return null;

  if (blockedCommand) {
    return (
      <div className="login-error" style={{ margin: '12px 16px' }}>
        <strong>{t('warehouse.blockedTitle', { kind: t(commandPhrase(blockedCommand.kind)) })}</strong>
        <br />
        {blockedCommand.error}
        <br />
        {/* Everything behind it is waiting on this decision, so it is stated
            rather than left for the storeman to work out from a count that
            has stopped moving. */}
        <span className="order-meta">
          {t('warehouse.blockedWaiting')}
          {pending > 0 ? ` ${t('warehouse.blockedQueue', { count: pending })}` : ''}
        </span>
        <div className="row-actions" style={{ marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={() => onRetry(blockedCommand.id)}>
            {t('warehouse.retry')}
          </button>
          <button className="btn btn-secondary" onClick={() => onDiscard(blockedCommand.id)}>
            {t('warehouse.discard')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field-hint" style={{ margin: '12px 16px' }}>
      {t('warehouse.queued', { count: pending })}
    </div>
  );
}
