/**
 * The four emails the server sends, as plain text. Pure: a link comes in,
 * a subject and a body come out, and nothing here knows how they leave.
 */

export type Message = { subject: string; text: string };

/**
 * Every link the server ever writes. From configuration, never from a
 * request: a link built from the Host header can be pointed at another host
 * by whoever sends the request.
 */
export function linkUrl(publicUrl: string, kind: 'confirm' | 'reset', token: string): string {
  return `${publicUrl}/#${kind}=${token}`;
}

const NOT_YOU = 'If this was not you, you can ignore this email; nothing changes until the link is opened.';

export function confirmEmail(link: string): Message {
  return {
    subject: 'Confirm your email for Nowline',
    text: `Open this link to confirm your email address:\n\n${link}\n\nThe link works for 24 hours.\n\n${NOT_YOU}`,
  };
}

export function resetPassword(link: string): Message {
  return {
    subject: 'Reset your Nowline password',
    text: `Open this link to choose a new password:\n\n${link}\n\nThe link works for one hour, and once. Using it signs every device out.\n\nIf this was not you, someone typed your address or is guessing at it: your password has not changed, and you can ignore this email.`,
  };
}

export function confirmNewEmail(link: string): Message {
  return {
    subject: 'Confirm your new email for Nowline',
    text: `Open this link to make this address the one on your Nowline account:\n\n${link}\n\nThe link works for 24 hours.\n\n${NOT_YOU}`,
  };
}

/** Goes to the old address, which is no longer the account's: the new one is shown masked. */
export function emailChanged(newEmail: string): Message {
  return {
    subject: 'Your Nowline email was changed',
    text: `The email on your Nowline account is now ${maskEmail(newEmail)}. This address will no longer receive anything from Nowline.\n\nIf this was not you, someone who knew your password made the change: get in touch with whoever runs this Nowline.`,
  };
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at < 1 ? '…' : `${email.slice(0, 1)}…${email.slice(at)}`;
}
