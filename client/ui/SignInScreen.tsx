import { useState, type JSX, type SubmitEvent } from 'react';
import { reportError, reportWarning } from '../reportError';
import { isFailure, login, logout, type ApiFailure, type Session } from '../storage/apiClient';
import { adoptSession, type AdoptAnswer, type AdoptQuestion } from '../storage/sync';
import { OtherAccountPrompt } from './OtherAccountPrompt';

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
  const [asking, setAsking] = useState<{ session: Session; question: AdoptQuestion } | null>(null);

  /**
   * The engine decides what a session means for the rows on this device; this
   * screen only shows the question when there is one. Writing the token here,
   * as this screen used to, is how one account's queue reached another's cloud.
   */
  async function hand(session: Session, answer: AdoptAnswer | null): Promise<void> {
    try {
      const outcome = await adoptSession(session, answer);
      if (outcome.kind === 'adopted') {
        setAsking(null);
        onSignedIn();
        return;
      }
      setAsking({ session, question: outcome });
    } catch (adoptError) {
      reportError('Preparing this device for the session failed', adoptError);
      setAsking(null);
      setError('This device could not be prepared. Please try again.');
    }
  }

  async function answer(choice: AdoptAnswer) {
    if (asking === null || submitting) return;
    setSubmitting(true);
    try {
      await hand(asking.session, choice);
    } finally {
      setSubmitting(false);
    }
  }

  function cancel() {
    if (asking === null) return;
    const { token } = asking.session;
    setAsking(null);
    // Nobody adopted this session, so the server should not keep it alive. The
    // form comes back either way; a failure is only worth a line in the log.
    void logout(token).then((result) => {
      if (isFailure(result)) reportWarning('Revoking a session nobody adopted failed', result);
    });
  }

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

      await hand(result, null);
    } finally {
      setSubmitting(false);
    }
  }

  if (asking !== null) {
    return (
      <OtherAccountPrompt
        question={asking.question}
        busy={submitting}
        onAnswer={(choice) => {
          void answer(choice);
        }}
        onCancel={cancel}
      />
    );
  }

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
