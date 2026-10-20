import { describe, expect, it } from 'vitest';

import { GET } from '../route';

// infrastructure/monitoring polls this route and its README documents the
// payload: the site has no database, so `db` is always "skipped".
describe('GET /api/health', () => {
  it('answers 200 with the documented payload', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', db: 'skipped' });
  });
});
