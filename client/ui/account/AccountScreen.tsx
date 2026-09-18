import { useEffect, useState, type JSX } from 'react';
import { loadAccount, resendConfirmation, signOutOfDevice, useAppState } from '../../state/store';
import { isFailure } from '../../storage/apiClient';
import { COULD_NOT_SEND, failureMessage } from '../failureMessage';
import { ChangeEmailForm } from './ChangeEmailForm';
import { SignOutPrompt } from './SignOutPrompt';

/**
 * What the server knows about the account, and the three things that can be
 * done about it. Decides nothing: the store asks once, the engine signs out.
 */
export function AccountScreen(): JSX.Element {
  const state = useAppState();

  const [resent, setResent] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [changing, setChanging] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [atRisk, setAtRisk] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  async function leave(answer: 'discard' | null): Promise<void> {
    if (leaving) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      const outcome = await signOutOfDevice(answer);
      if (outcome.kind === 'at-risk') {
        setAtRisk(outcome.atRisk);
        return;
      }
      setAtRisk(null);
      if (outcome.kind === 'offline' || outcome.kind === 'refused') {
        const status = outcome.kind === 'refused' ? outcome.status : null;
        setLeaveError(failureMessage({ failed: true, kind: outcome.kind, status, detail: null }));
      }
      // signed-out: the store already decided the entry; this screen is about to unmount.
    } finally {
      setLeaving(false);
    }
  }

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
      <section className="account__row">
        {linkSentTo !== null && (
          <p className="account__value" role="status">
            Check {linkSentTo} for a link. Your email changes when you open it.
          </p>
        )}
        {changing ? (
          <ChangeEmailForm
            onSent={(to) => {
              setLinkSentTo(to);
              setChanging(false);
            }}
            onCancel={() => {
              setChanging(false);
            }}
          />
        ) : (
          <div className="account__actions">
            <button
              className="button"
              type="button"
              onClick={() => {
                setLinkSentTo(null);
                setChanging(true);
              }}
            >
              Change email
            </button>
          </div>
        )}
      </section>
      <section className="account__row">
        {leaveError && (
          <p className="error" role="alert">
            {leaveError}
          </p>
        )}
        {atRisk !== null ? (
          <SignOutPrompt
            atRisk={atRisk}
            busy={leaving}
            onConfirm={() => {
              void leave('discard');
            }}
            onCancel={() => {
              setAtRisk(null);
            }}
          />
        ) : (
          <div className="account__actions">
            <button
              className="button"
              type="button"
              disabled={leaving}
              onClick={() => {
                void leave(null);
              }}
            >
              {leaving ? 'Signing out' : 'Sign out'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
