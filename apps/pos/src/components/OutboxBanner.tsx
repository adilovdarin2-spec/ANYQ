import { commandLabel } from '../outbox';
import type { WarehouseCommand } from '../outbox';

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
  if (!pending && !blockedCommand) return null;

  if (blockedCommand) {
    return (
      <div className="login-error" style={{ margin: '12px 16px' }}>
        <strong>{commandLabel(blockedCommand.kind)}: сервер не принял</strong>
        <br />
        {blockedCommand.error}
        <br />
        {/* Everything behind it is waiting on this decision, so it is stated
            rather than left for the storeman to work out from a count that
            has stopped moving. */}
        <span className="order-meta">
          Остальные операции склада ждут: следующие рассчитаны на то, что эта прошла.
          {pending > 0 ? ` В очереди ещё ${pending}.` : ''}
        </span>
        <div className="row-actions" style={{ marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={() => onRetry(blockedCommand.id)}>
            Повторить
          </button>
          <button className="btn btn-secondary" onClick={() => onDiscard(blockedCommand.id)}>
            Отменить операцию
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field-hint" style={{ margin: '12px 16px' }}>
      Операций склада ждут отправки: {pending}. Уйдут сами, когда появится связь.
    </div>
  );
}
