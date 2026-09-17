import { useState, type JSX, type SubmitEvent } from 'react';
import { isFailure, login } from '../storage/apiClient';
import { failureMessage } from './failureMessage';
import type { GateView } from './gate';
import { useSessionHandoff } from './useSessionHandoff';

type Props = { onSignedIn: () => void; onSwitch: (to: GateView) => void };

export function SignInScreen({ onSignedIn, onSwitch }: Props): JSX.Element {
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
      const result = await login(email, password);
      if (isFailure(result)) {
        setError(failureMessage(result, 'The email or password is wrong.'));
        return;
      }

      await offer(result);
    } finally {
      setSubmitting(false);
    }
  }

  if (prompt !== null) return prompt;

  return (
    <div className="gate">
      <h1 className="sheet__title">Sign in</h1>
      <form aria-label="Sign in" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="field" htmlFor="sign-in-email">
          <span className="field__label">Email</span>
          <input
            id="sign-in-email"
            className="field__input"
            type="email"
            value={email}
            autoComplete="email"
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </label>

        <label className="field" htmlFor="sign-in-password">
          <span className="field__label">Password</span>
          <input
            id="sign-in-password"
            className="field__input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => {
              setPassword(event.target.value);
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
            {submitting ? 'Signing in' : 'Sign in'}
          </button>
        </div>
      </form>
      <div className="gate__links">
        <button
          className="button button--link"
          type="button"
          onClick={() => {
            onSwitch('create');
          }}
        >
          Create account
        </button>
        <button
          className="button button--link"
          type="button"
          onClick={() => {
            onSwitch('forgot');
          }}
        >
          Forgot password?
        </button>
      </div>
    </div>
  );
}
