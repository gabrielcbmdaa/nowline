import { useState, type JSX } from 'react';
import { reportError, reportWarning } from '../reportError';
import { isFailure, logout, type Session } from '../storage/apiClient';
import { adoptSession, type AdoptAnswer, type AdoptQuestion } from '../storage/sync';
import { OtherAccountPrompt } from './OtherAccountPrompt';

export const COULD_NOT_PREPARE = 'This device could not be prepared. Please try again.';

type Events = {
  onAdopted: () => void;
  onFailed: (message: string) => void;
  /** After Cancel, once the unused session has been sent to be forgotten. */
  onCancelled?: () => void;
};

/**
 * How every gate screen hands a session it received to the engine. The engine
 * decides what the session means for the rows on this device; the screen only
 * shows the question when there is one, in place of its own form. A screen that
 * wrote the token itself is how one account's queue reached another's cloud.
 */
export function useSessionHandoff({ onAdopted, onFailed, onCancelled }: Events): {
  offer: (session: Session) => Promise<void>;
  prompt: JSX.Element | null;
} {
  const [asking, setAsking] = useState<{ session: Session; question: AdoptQuestion } | null>(null);
  const [answering, setAnswering] = useState(false);

  async function hand(session: Session, answer: AdoptAnswer | null): Promise<void> {
    try {
      const outcome = await adoptSession(session, answer);
      if (outcome.kind === 'adopted') {
        setAsking(null);
        onAdopted();
        return;
      }
      setAsking({ session, question: outcome });
    } catch (adoptError) {
      reportError('Preparing this device for the session failed', adoptError);
      setAsking(null);
      onFailed(COULD_NOT_PREPARE);
    }
  }

  async function answer(choice: AdoptAnswer): Promise<void> {
    if (asking === null || answering) return;
    setAnswering(true);
    try {
      await hand(asking.session, choice);
    } finally {
      setAnswering(false);
    }
  }

  function cancel(): void {
    if (asking === null) return;
    const { token } = asking.session;
    setAsking(null);
    // Nobody adopted this session, so the server should not keep it alive. The
    // screen comes back either way; a failure is only worth a line in the log.
    void logout(token).then((result) => {
      if (isFailure(result)) reportWarning('Revoking a session nobody adopted failed', result);
    });
    onCancelled?.();
  }

  const prompt =
    asking === null ? null : (
      <OtherAccountPrompt
        question={asking.question}
        busy={answering}
        onAnswer={(choice) => {
          void answer(choice);
        }}
        onCancel={cancel}
      />
    );

  return {
    offer: (session) => hand(session, null),
    prompt,
  };
}
