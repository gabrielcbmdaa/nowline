import { describe, expect, it } from 'vitest';
import { wins } from './merge.js';

describe('who wins', () => {
  it('lets a row in when the server has never seen it', () => {
    expect(wins({ updatedAt: '2026-09-08T10:00:00.000Z' }, null)).toBe(true);
  });

  it('lets the newer change replace the older one', () => {
    expect(
      wins({ updatedAt: '2026-09-08T11:00:00.000Z' }, { updatedAt: '2026-09-08T10:00:00.000Z' }),
    ).toBe(true);
  });

  it('keeps what is stored when the arriving copy is older', () => {
    expect(
      wins({ updatedAt: '2026-09-08T09:00:00.000Z' }, { updatedAt: '2026-09-08T10:00:00.000Z' }),
    ).toBe(false);
  });

  it('keeps what is stored on an exact tie, so a resend changes nothing', () => {
    const same = '2026-09-08T10:00:00.000Z';
    expect(wins({ updatedAt: same }, { updatedAt: same })).toBe(false);
  });
});
