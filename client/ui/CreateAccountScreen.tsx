import { useState, type JSX, type SubmitEvent } from 'react';
import { isFailure, register } from '../storage/apiClient';
import { failureMessage } from './failureMessage';
import type { GateView } from './gate';
import { PasswordField } from './PasswordField';
import { useSessionHandoff } from './useSessionHandoff';

type Props = { onSignedIn: () => void; onSwitch: (to: GateView) => void };

export function CreateAccountScreen({ onSignedIn, onSwitch }: Props): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { offer, prompt } = useSessionHandoff({ onAdopted: onSignedIn, onFailed: setError });

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await register(email, password);
      if (isFailure(result)) {
        setError(failureMessage(result));
        return;
      }
      // Straight in, like signing in: the confirmation email is on its way, and
      // the account tab says the address is not confirmed yet.
      await offer(result);
    } finally {
      setSubmitting(false);
    }
  }

  if (prompt !== null) return prompt;

  return (
    <div className="gate">
      <h1 className="sheet__title">Create account</h1>
      <form aria-label="Create account" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="field" htmlFor="create-email">
          <span className="field__label">Email</span>
          <input
            id="create-email"
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
          id="create-password"
          label="Password"
          value={password}
          autoComplete="new-password"
          onChange={setPassword}
        />

        <p className="gate__note">Password recovery goes to this address, so make sure it is yours.</p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="gate__actions">
          <button className="button button--primary" type="submit" disabled={submitting}>
            {submitting ? 'Creating account' : 'Create account'}
          </button>
        </div>
      </form>

      <div className="gate__links">
        <button
          className="button button--link"
          type="button"
          onClick={() => {
            onSwitch('sign-in');
          }}
        >
          Sign in instead
        </button>
      </div>
    </div>
  );
}
