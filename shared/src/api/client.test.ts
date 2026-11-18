import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, getUser, listUsers, signOut, updateMe } from '../index';

const user = {
  id: '01936b2e-7c3a-7cc0-8000-000000000001',
  name: 'Asha Example',
  role: { key: 'rd_lead', name: 'R&D Lead', departmentCode: 'RND' },
  productLine: null,
  status: 'active',
};

function fakeFetch(status: number, body: unknown, contentType = 'application/json') {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': contentType },
      }),
  );
}

describe('createApiClient', () => {
  it('fills path parameters and parses the response', async () => {
    const fetch = fakeFetch(200, user);
    const api = createApiClient({ baseUrl: 'http://api', fetch });

    await expect(api(getUser, { params: { id: user.id } })).resolves.toEqual(user);
    expect(fetch.mock.calls[0]?.[0]).toBe(`http://api/api/v1/users/${user.id}`);
  });

  it('skips empty query values and sends bracketed filters as they are', async () => {
    const fetch = fakeFetch(200, { items: [], nextCursor: null });
    const api = createApiClient({ fetch });

    await api(listUsers, { query: { 'filter[role]': 'pme', q: '', limit: 10 } });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/users?filter%5Brole%5D=pme&limit=10');
  });

  it('sends If-Match and returns nothing for 204 responses', async () => {
    const fetch = fakeFetch(204, undefined);
    const api = createApiClient({ fetch });

    await expect(api(signOut)).resolves.toBeUndefined();

    const patch = fakeFetch(200, { ...user, updatedAt: '2026-11-18T10:00:00.000Z' });
    await createApiClient({ fetch: patch })(updateMe, {
      body: { name: 'Asha E' },
      ifMatch: '2026-11-18T09:00:00.000Z',
    });
    const init = patch.mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
    expect((init?.headers as Record<string, string>)['if-match']).toBe('2026-11-18T09:00:00.000Z');
  });

  it('throws an ApiError carrying the problem code', async () => {
    const fetch = fakeFetch(
      403,
      {
        type: 'about:blank',
        title: 'Not allowed',
        status: 403,
        code: 'NOT_ALLOWED',
        whoCan: ['VP'],
      },
      'application/problem+json',
    );
    const api = createApiClient({ fetch });

    const error = await api(getUser, { params: { id: user.id } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_ALLOWED');
    expect((error as ApiError).problem.whoCan).toEqual(['VP']);
  });
});
