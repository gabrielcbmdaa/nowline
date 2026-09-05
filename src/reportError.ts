/**
 * One place for the failures the app recovers from by itself. Recovering is not the
 * same as nothing having happened: without this line the error object is dropped and
 * whoever debugs it later starts from the symptom alone. On 2026-09-04 that cost an
 * afternoon — the thrown error read `crypto.randomUUID is not a function`, which
 * names its own cause, and it was discarded one line from where it would have said so.
 *
 * The day this ships somewhere a console cannot be opened, this is the one function
 * that has to change.
 */
export function reportError(context: string, error: unknown): void {
  console.error(`[nowline] ${context}`, error);
}

/** For what the app is built to survive, where a failure is a state, not a defect. */
export function reportWarning(context: string, error: unknown): void {
  console.warn(`[nowline] ${context}`, error);
}
