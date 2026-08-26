import { useCallback, useState } from 'react';

/**
 * Wraps an API-calling action handler so a failure surfaces to the user instead
 * of silently doing nothing. apiClient already turns the server's {error} body
 * into a thrown Error with that message.
 */
export function useAction() {
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { error, run };
}
