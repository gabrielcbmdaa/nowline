// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { takeEmailLink } from './emailLink';

const TOKEN = 'ab'.repeat(32);

function visit(url: string): void {
  window.history.replaceState(null, '', url);
}

const take = () => takeEmailLink(window.location, window.history);

describe('takeEmailLink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    visit('/');
  });

  it('takes a confirmation link and removes it from the address bar', () => {
    visit(`/?from=mail#confirm=${TOKEN}`);

    expect(take()).toEqual({ kind: 'confirm', token: TOKEN });
    // The secret must not stay in the history or in a bookmark; the rest of
    // the address is not this function's to change.
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/?from=mail');
  });

  it('takes a reset link the same way', () => {
    visit(`/#reset=${TOKEN}`);

    expect(take()).toEqual({ kind: 'reset', token: TOKEN });
    expect(window.location.hash).toBe('');
  });

  it('removes a malformed link too, and takes nothing from it', () => {
    for (const fragment of [
      `#reset=${TOKEN.slice(1)}`,
      `#reset=${TOKEN.toUpperCase()}`,
      `#confirm=${TOKEN}0`,
      '#confirm=',
    ]) {
      visit(`/${fragment}`);

      expect(take()).toBeNull();
      // A token one character short is still most of a secret.
      expect(window.location.hash).toBe('');
    }
  });

  it('leaves any other fragment alone', () => {
    for (const fragment of ['#top', `#confirmed=${TOKEN}`, `#resets=${TOKEN}`]) {
      visit(`/${fragment}`);

      expect(take()).toBeNull();
      expect(window.location.hash).toBe(fragment);
    }
  });

  it('finds nothing the second time, because the first look cleaned the address', () => {
    visit(`/#confirm=${TOKEN}`);

    expect(take()).not.toBeNull();
    expect(take()).toBeNull();
  });

  it('replaces the history entry instead of adding one, so Back does not bring the secret back', () => {
    visit(`/#confirm=${TOKEN}`);
    const before = window.history.length;
    const pushState = vi.spyOn(window.history, 'pushState');

    expect(take()).toEqual({ kind: 'confirm', token: TOKEN });

    // pushState would clear the address bar too, and leave the token one
    // Back away. The person's history must not gain an entry here.
    expect(window.history.length).toBe(before);
    expect(pushState).not.toHaveBeenCalled();
  });
});
