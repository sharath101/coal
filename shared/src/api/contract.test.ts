import { describe, expect, it } from 'vitest';
import { AI_TIERS, ENDPOINTS, pathParamNames } from '../index';

describe('endpoint contracts', () => {
  it('have unique ids and unique method + path pairs', () => {
    const ids = ENDPOINTS.map((e) => e.id);
    const routes = ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it.each(ENDPOINTS.map((e) => [e.id, e] as const))(
    '%s declares a permission, an AI tier and matching path parameters',
    (_, endpoint) => {
      expect(endpoint.permission).toMatch(/^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+$/);
      expect(AI_TIERS).toContain(endpoint.aiTier);

      const declared = 'params' in endpoint ? Object.keys(endpoint.params.shape).sort() : [];
      expect(declared).toEqual(pathParamNames(endpoint.path).sort());
    },
  );

  it('keep public endpoints to sign-up, sign-in and the lists the sign-up form needs', () => {
    const publicIds = ENDPOINTS.filter((e) => e.auth === 'public').map((e) => e.id);
    expect(publicIds.sort()).toEqual(
      ['auth.signIn', 'auth.signUp', 'org.listRoles', 'rnd.listProductLines'].sort(),
    );
  });
});
