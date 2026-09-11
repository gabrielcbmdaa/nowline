import { useState, type JSX } from 'react';
import { settleFirstSync, type SyncOutcome } from '../storage/sync';

type Props = {
  local: number;
  remote: number;
  onSettled: () => void;
  onSignedOut: () => void;
};

function outcomeMessage(outcome: SyncOutcome): string {
  if (outcome.kind === 'offline') {
    return 'No answer from the server. Check your connection.';
  }
  if (outcome.kind === 'refused') {
    if (outcome.status === 429) {
      return 'Too many attempts. Try again in a few minutes.';
    }
    return `The server did not accept the request (${String(outcome.status)}).`;
  }
  if (outcome.kind === 'needs-first-sync') {
    return 'The first-sync question is still open.';
  }
  if (outcome.kind === 'undecided') {
    return 'The sync engine could not finish this choice.';
  }
  return 'Something went wrong.';
}

export function FirstSyncScreen({ local, remote, onSettled, onSignedOut }: Props): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  async function carryOut(choice: 'upload-mine' | 'take-the-cloud') {
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const outcome = await settleFirstSync(choice);
      if (outcome.kind === 'done') {
        onSettled();
        return;
      }
      if (outcome.kind === 'unauthorized') {
        onSignedOut();
        return;
      }
      setError(outcomeMessage(outcome));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="gate">
      <h1 className="sheet__title">Two copies of your data</h1>
      <p>
        This device has {local} unsynced blocks. The cloud has {remote}.
      </p>
      <p>
        Upload mine adds this device&apos;s blocks to the cloud. Take the cloud replaces them with
        the cloud&apos;s.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="gate__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={submitting}
          onClick={() => {
            void carryOut('upload-mine');
          }}
        >
          {submitting ? 'Working' : 'Upload mine'}
        </button>

        {confirmReplace ? (
          <button
            className="button button--danger"
            type="button"
            disabled={submitting}
            onClick={() => {
              void carryOut('take-the-cloud');
            }}
          >
            {submitting ? 'Working' : 'Yes, replace mine'}
          </button>
        ) : (
          <button
            className="button"
            type="button"
            disabled={submitting}
            onClick={() => {
              setConfirmReplace(true);
            }}
          >
            Take the cloud
          </button>
        )}
      </div>
    </div>
  );
}
