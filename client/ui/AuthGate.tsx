import { useState, type JSX } from 'react';
import { CreateAccountScreen } from './CreateAccountScreen';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';
import type { GateView } from './gate';
import { SignInScreen } from './SignInScreen';

type Props = { onSignedIn: () => void };

/** What a signed-out device shows: one of three screens, and nothing it decides. */
export function AuthGate({ onSignedIn }: Props): JSX.Element {
  const [view, setView] = useState<GateView>('sign-in');

  if (view === 'create') return <CreateAccountScreen onSignedIn={onSignedIn} onSwitch={setView} />;
  if (view === 'forgot') return <ForgotPasswordScreen onSwitch={setView} />;
  return <SignInScreen onSignedIn={onSignedIn} onSwitch={setView} />;
}
