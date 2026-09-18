import { useEffect, useState, type JSX } from 'react';
import { loadAccount, resendConfirmation, useAppState } from '../../state/store';
import { isFailure } from '../../storage/apiClient';
import { COULD_NOT_SEND, failureMessage } from '../failureMessage';

/**
 * What the server knows about the account, and the three things that can be
 * done about it. Decides nothing: the store asks once, the engine signs out.
 */
export function AccountScreen(): JSX.Element {
  const state = useAppState();

  const [resent, setResent] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  async function resend(): Promise<void> {
    if (resending) return;
    setResending(true);
    setResendError(null);
    try {
      const result = await resendConfirmation();
      if (result === null) return;
      if (isFailure(result)) {
        setResendError(failureMessage(result));
        return;
      }
      if (!result.sent) {
        setResendError(COULD_NOT_SEND);
        return;
      }
      setResent(state.account?.email ?? null);
    } finally {
      setResending(false);
    }
  }

  useEffect(() => {
    void loadAccount();
  }, []);

  if (state.accountFailure !== null) {
    return (
      <div className="account">
        <p className="error" role="alert">
          {failureMessage(state.accountFailure)}
        </p>
        <div className="account__actions">
          <button
            className="button"
            type="button"
            onClick={() => {
              void loadAccount();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.account === null) return <p className="placeholder">Loading…</p>;

  const { email, verifiedAt } = state.account;

  return (
    <div className="account">
      <section className="account__row">
        <h2 className="account__label">Email</h2>
        {email === null ? (
          <p className="account__value">
            No email on this account. Add one to sign in on other devices and recover your password.
          </p>
        ) : (
          <>
            <p className="account__value">{email}</p>
            {verifiedAt !== null ? (
              <p className="account__value">Confirmed</p>
            ) : resent !== null ? (
              <p className="account__value" role="status">
                Sent to {resent}.
              </p>
            ) : (
              <>
                <p className="account__value">Not confirmed</p>
                {resendError && (
                  <p className="error" role="alert">
                    {resendError}
                  </p>
                )}
                <div className="account__actions">
                  <button
                    className="button"
                    type="button"
                    disabled={resending}
                    onClick={() => {
                      void resend();
                    }}
                  >
                    {resending ? 'Sending' : 'Resend confirmation'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
