import { useEffect, type JSX } from 'react';
import { loadAccount, useAppState } from '../../state/store';
import { failureMessage } from '../failureMessage';

/**
 * What the server knows about the account, and the three things that can be
 * done about it. Decides nothing: the store asks once, the engine signs out.
 */
export function AccountScreen(): JSX.Element {
  const state = useAppState();

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
            <p className="account__value">{verifiedAt === null ? 'Not confirmed' : 'Confirmed'}</p>
          </>
        )}
      </section>
    </div>
  );
}
