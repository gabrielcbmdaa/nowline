/**
 * Last write wins, decided by the device clock that stamped the row. ISO
 * strings of the same shape compare correctly as text, so no conversion to
 * Date is needed — and a tie keeps what is stored, because the client
 * resends anything it was not told arrived.
 */
export function wins(
  incoming: { updatedAt: string },
  stored: { updatedAt: string } | null,
): boolean {
  if (!stored) return true;
  return incoming.updatedAt > stored.updatedAt;
}
