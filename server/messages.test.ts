import { describe, expect, it } from 'vitest';
import { confirmEmail, confirmNewEmail, emailChanged, linkUrl, resetPassword } from './messages.js';

const link = 'https://nowline.test/#confirm=abc';

describe('linkUrl', () => {
  it('puts the token in the fragment, after the configured origin', () => {
    expect(linkUrl('https://nowline.test', 'confirm', 'abc')).toBe('https://nowline.test/#confirm=abc');
    expect(linkUrl('https://nowline.test', 'reset', 'abc')).toBe('https://nowline.test/#reset=abc');
  });
});

describe('the emails', () => {
  it.each([
    ['confirmEmail', confirmEmail(link)],
    ['resetPassword', resetPassword(link)],
    ['confirmNewEmail', confirmNewEmail(link)],
  ])('%s carries its link and a line for when it was not you', (_name, message) => {
    expect(message.subject).not.toBe('');
    expect(message.text).toContain(link);
    expect(message.text).toMatch(/If this was not you/);
  });

  it('tells the old address that the email changed, without giving the new one away', () => {
    const message = emailChanged('nueva@example.com');

    expect(message.text).toContain('n…@example.com');
    expect(message.text).not.toContain('nueva@');
    expect(message.text).toMatch(/If this was not you/);
  });

  it('is plain text: no tags anywhere', () => {
    for (const message of [confirmEmail(link), resetPassword(link), confirmNewEmail(link), emailChanged('a@b')]) {
      expect(message.text).not.toMatch(/<[a-z]+>/i);
    }
  });
});
