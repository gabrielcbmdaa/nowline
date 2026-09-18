import { useEffect, useState, type JSX } from 'react';
import { CONFIRM_ARMS_AFTER_MS } from '../FirstSyncScreen';

type Props = {
  atRisk: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Folds out under "Sign out" when the engine found changes no cloud has. The
 * button that removes them arms after the first-sync confirmation's delay, so
 * the second tap of a double tap lands on a button that does nothing yet.
 * Cancel changes nothing and does not wait. The engine counted; this shows.
 */
export function SignOutPrompt({ atRisk, busy, onConfirm, onCancel }: Props): JSX.Element {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setArmed(true);
    }, CONFIRM_ARMS_AFTER_MS);
    return () => {
      clearTimeout(id);
    };
  }, []);

  const one = atRisk === 1;

  return (
    <div className="account__row">
      <p className="account__value">
        {atRisk} {one ? 'change has' : 'changes have'} not been uploaded and will be removed from this
        device; a copy stays in its storage.
      </p>
      <div className="account__actions">
        <button className="button button--danger" type="button" disabled={busy || !armed} onClick={onConfirm}>
          Sign out anyway
        </button>
        <button className="button" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
