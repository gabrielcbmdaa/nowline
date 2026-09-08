import { describe, expect, it } from 'vitest';
import { createApp } from './index.js';
import { call } from './testing/http.js';

describe('the server', () => {
  it('answers that it is alive', async () => {
    const reply = await call(createApp(), '/api/health');

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true });
  });

  it('answers 404 in JSON, not in HTML', async () => {
    const reply = await call(createApp(), '/api/nothing-here');

    expect(reply.status).toBe(404);
    expect(reply.contentType).toContain('application/json');
  });
});
