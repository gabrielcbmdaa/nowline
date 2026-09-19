import { useState, type JSX, type SubmitEvent } from 'react';
import { isFailure, requestReset } from '../storage/apiClient';
import { failureMessage } from './failureMessage';
import type { GateView } from './gate';

/**
 * The same words for every address, because the server's answer is the same
 * for every address: whether an account exists is not this screen's to say.
 */
export const RESET_REQUESTED =
  'If that address has a confirmed account, a link is on its way. It works for one hour.';

type Props = { onSwitch: (to: GateView) => void };

export function ForgotPasswordScreen({ onSwitch }: Props): JSX.Element {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requested, setRequested] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await requestReset(email);
      // A request that never reached the server, or was turned away before it
      // looked anything up, says nothing about the account — and "a link is on
      // its way" would be untrue.
      if (isFailure(result)) {
        setError(failureMessage(result));
        return;
      }
      setRequested(true);
    } finally {
      setSubmitting(false);
    }
  }

  const back = (
    <div className="gate__links">
      <button
        className="button button--link"
        type="button"
        onClick={() => {
          onSwitch('sign-in');
        }}
      >
        Back to sign in
      </button>
    </div>
  );

  if (requested) {
    return (
      <div className="gate">
        <h1 className="sheet__title">Check your email</h1>
        <p role="status">{RESET_REQUESTED}</p>
        {back}
      </div>
    );
  }

  return (
    <div className="gate">
      <h1 className="sheet__title">Forgot password</h1>
      <form aria-label="Forgot password" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="field" htmlFor="forgot-email">
          <span className="field__label">Email</span>
          <input
            id="forgot-email"
            className="field__input"
            type="email"
            value={email}
            autoComplete="email"
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="gate__actions">
          <button className="button button--primary" type="submit" disabled={submitting}>
            {submitting ? 'Sending' : 'Send link'}
          </button>
        </div>
      </form>
      {back}
    </div>
  );
}
