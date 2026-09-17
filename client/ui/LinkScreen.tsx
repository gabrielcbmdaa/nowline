import { useState, type JSX, type SubmitEvent } from 'react';
import type { EmailLink } from '../state/emailLink';
import { confirmLink, isFailure, resetPassword } from '../storage/apiClient';
import { failureMessage } from './failureMessage';
import { PasswordField } from './PasswordField';
import { useSessionHandoff } from './useSessionHandoff';

type Props = { link: EmailLink; onDone: () => void };

/**
 * What an emailed link opens. Nothing here runs on mount: mail clients and
 * scanners open links to preview them, and a page that spent its token on load
 * would hand the person a link that was already used. Only a button spends it.
 */
export function LinkScreen({ link, onDone }: Props): JSX.Element {
  return link.kind === 'confirm' ? (
    <ConfirmLink token={link.token} onDone={onDone} />
  ) : (
    <ResetLink token={link.token} onDone={onDone} />
  );
}

function ConfirmLink({ token, onDone }: { token: string; onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmLink(token);
      if (isFailure(result)) {
        setError(failureMessage(result));
        return;
      }
      setConfirmed(result.confirmed === 'email' ? 'Email confirmed.' : `Your email is now ${result.email}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <h1 className="sheet__title">Confirm your email</h1>

      {confirmed !== null && <p role="status">{confirmed}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="gate__actions">
        {confirmed === null ? (
          <>
            <button
              className="button button--primary"
              type="button"
              disabled={busy}
              onClick={() => {
                void confirm();
              }}
            >
              {busy ? 'Confirming' : 'Confirm email'}
            </button>
            <button className="button" type="button" disabled={busy} onClick={onDone}>
              Not now
            </button>
          </>
        ) : (
          <button className="button button--primary" type="button" onClick={onDone}>
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

function ResetLink({ token, onDone }: { token: string; onDone: () => void }): JSX.Element {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftAlone, setLeftAlone] = useState(false);
  const { offer, prompt } = useSessionHandoff({
    onAdopted: onDone,
    onFailed: setError,
    onCancelled: () => {
      setLeftAlone(true);
    },
  });

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resetPassword(token, password);
      if (isFailure(result)) {
        setError(failureMessage(result));
        return;
      }
      // Every other session of the account has just ended, this device's
      // included; the new one goes through the engine like any other.
      await offer(result);
    } finally {
      setBusy(false);
    }
  }

  if (prompt !== null) return prompt;

  if (leftAlone) {
    return (
      <div className="gate">
        <h1 className="sheet__title">Password changed</h1>
        <p role="status">Your password has changed. This device was left as it was; sign in when you are ready.</p>
        <div className="gate__actions">
          <button className="button button--primary" type="button" onClick={onDone}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <h1 className="sheet__title">Choose a new password</h1>
      <form aria-label="Choose a new password" onSubmit={(event) => { void handleSubmit(event); }}>
        <PasswordField
          id="reset-password"
          label="New password"
          value={password}
          autoComplete="new-password"
          onChange={setPassword}
        />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="gate__actions">
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? 'Changing password' : 'Change password'}
          </button>
          <button className="button" type="button" disabled={busy} onClick={onDone}>
            Not now
          </button>
        </div>
      </form>
    </div>
  );
}
