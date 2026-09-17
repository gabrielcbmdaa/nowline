import { useState, type JSX, type SubmitEvent } from 'react';
import { isFailure, login } from '../storage/apiClient';
import { failureMessage } from './failureMessage';
import { useSessionHandoff } from './useSessionHandoff';

type Props = { onSignedIn: () => void };

export function SignInScreen({ onSignedIn }: Props): JSX.Element {
  const [username, setUsername] = useState('');
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
      const result = await login(username, password);
      if (isFailure(result)) {
        setError(failureMessage(result, 'The username or password is wrong.'));
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
      <form aria-label="Sign in" onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="field" htmlFor="sign-in-username">
          <span className="field__label">Username</span>
          <input
            id="sign-in-username"
            className="field__input"
            value={username}
            autoComplete="username"
            onChange={(event) => {
              setUsername(event.target.value);
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
    </div>
  );
}
