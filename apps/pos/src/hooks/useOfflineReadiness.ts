import { useEffect, useState } from 'react';
import { offlineReadiness, subscribeOfflineReadiness } from '../offline';
import type { OfflineReadiness } from '../offline';

/**
 * Whether the till can be opened without a network, for a screen to say so.
 *
 * Subscribes rather than reading once: registration finishes after the first
 * paint, so a component that only read the value on mount would show "unknown"
 * for the life of the session.
 */
export function useOfflineReadiness(): OfflineReadiness {
  const [state, setState] = useState<OfflineReadiness>(offlineReadiness);

  useEffect(() => {
    const update = () => setState(offlineReadiness());
    const unsubscribe = subscribeOfflineReadiness(update);
    // Read again on mount: registration may have settled between this component
    // being created and the effect running.
    update();
    return unsubscribe;
  }, []);

  return state;
}
