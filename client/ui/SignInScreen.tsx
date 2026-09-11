import { useState, type JSX, type SubmitEvent } from 'react';
import { isFailure, login, type ApiFailure } from '../storage/apiClient';
import { repository } from '../storage/repository';

type Props = { onSignedIn: () => void };

function failureMessage(failure: ApiFailure): string {
  if (failure.kind === 'unauthorized') {
    return 'The username or password is wrong.';
  }
  if (failure.kind === 'offline') {
    return 'No answer from the server. Check your connection.';
  }
  if (failure.status === 429) {
    return 'Too many attempts. Try again in a few minutes.';
  }
  return `The server did not accept the request (${String(failure.status)}).`;
}

export function SignInScreen({ onSignedIn }: Props): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await login(username, password);
      if (isFailure(result)) {
        setError(failureMessage(result));
        return;
      }

      // Read first, write the token only: the flag and the cursor belong to the
      // engine and this screen has no business overwriting either.
      const state = await repository.readSyncState();
      await repository.writeSyncState({ ...state, token: result.token });
      onSignedIn();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form aria-label="Sign in" onSubmit={(event) => { void handleSubmit(event); }}>
      <label className="field" htmlFor="sign-in-username">
        <span className="field__label">Username</span>
      </label>
      <input
        id="sign-in-username"
        className="field__input"
        value={username}
        autoComplete="username"
        onChange={(event) => {
          setUsername(event.target.value);
        }}
      />

      <label className="field" htmlFor="sign-in-password">
        <span className="field__label">Password</span>
      </label>
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

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button className="button button--primary" type="submit" disabled={submitting}>
        {submitting ? 'Signing in' : 'Sign in'}
      </button>
    </form>
  );
}
