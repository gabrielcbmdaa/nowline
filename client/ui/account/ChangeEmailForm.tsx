import { useState, type JSX, type SubmitEvent } from 'react';
import { changeAccountEmail } from '../../state/store';
import { isFailure } from '../../storage/apiClient';
import { COULD_NOT_SEND, failureMessage } from '../failureMessage';
import { PasswordField } from '../PasswordField';

type Props = {
  /** The link went out to this address; the account changes when it is opened. */
  onSent: (email: string) => void;
  onCancel: () => void;
};

export function ChangeEmailForm({ onSent, onCancel }: Props): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await changeAccountEmail(email, password);
      if (result === null) return;
      if (isFailure(result)) {
        // A 403 lands here as "The password is wrong."; the session is untouched.
        setError(failureMessage(result));
        return;
      }
      if (!result.sent) {
        setError(COULD_NOT_SEND);
        return;
      }
      onSent(email);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form aria-label="Change email" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
      <label className="field" htmlFor="change-email">
        <span className="field__label">New email</span>
        <input
          id="change-email"
          className="field__input"
          type="email"
          value={email}
          autoComplete="email"
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </label>

      <PasswordField
        id="change-email-password"
        label="Current password"
        value={password}
        autoComplete="current-password"
        onChange={setPassword}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="account__actions">
        <button className="button button--primary" type="submit" disabled={submitting}>
          {submitting ? 'Sending' : 'Send confirmation'}
        </button>
        <button className="button" type="button" disabled={submitting} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
