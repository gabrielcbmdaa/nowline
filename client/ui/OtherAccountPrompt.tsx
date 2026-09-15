import { useEffect, useState, type JSX } from 'react';
import type { AdoptAnswer, AdoptQuestion } from '../storage/sync';
import { CONFIRM_ARMS_AFTER_MS } from './FirstSyncScreen';

type Props = {
  question: AdoptQuestion;
  busy: boolean;
  onAnswer: (answer: AdoptAnswer) => void;
  onCancel: () => void;
};

/**
 * Shown where the sign-in form was, so the second tap of a double tap on
 * "Sign in" lands here. Every button that changes this device's rows arms after
 * the first-sync confirmation's delay; Cancel changes nothing and does not wait.
 * The engine decided there is a question; this only shows its number.
 */
export function OtherAccountPrompt({ question, busy, onAnswer, onCancel }: Props): JSX.Element {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setArmed(true);
    }, CONFIRM_ARMS_AFTER_MS);
    return () => {
      clearTimeout(id);
    };
  }, []);

  const locked = busy || !armed;

  if (question.kind === 'other-account') {
    const one = question.atRisk === 1;
    return (
      <div className="gate">
        <h1 className="sheet__title">This device holds another account&apos;s data</h1>
        <p>
          {question.atRisk} {one ? 'change' : 'changes'} made here {one ? 'has' : 'have'} not
          reached that account&apos;s cloud. Continuing removes {one ? 'it' : 'them'} from this
          device; a copy stays in this device&apos;s storage.
        </p>
        <div className="gate__actions">
          <button
            className="button button--danger"
            type="button"
            disabled={locked}
            onClick={() => {
              onAnswer('discard');
            }}
          >
            Remove and continue
          </button>
          <button className="button" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const one = question.rows === 1;
  return (
    <div className="gate">
      <h1 className="sheet__title">Data from before accounts</h1>
      <p>
        This device holds {question.rows} {one ? 'block' : 'blocks'} not linked to any account.
        Kept, {one ? 'it joins' : 'they join'} this account; removed, a copy stays in this
        device&apos;s storage.
      </p>
      <div className="gate__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={locked}
          onClick={() => {
            onAnswer('keep');
          }}
        >
          They are mine, keep them
        </button>
        <button
          className="button button--danger"
          type="button"
          disabled={locked}
          onClick={() => {
            onAnswer('discard');
          }}
        >
          Remove them
        </button>
        <button className="button" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
