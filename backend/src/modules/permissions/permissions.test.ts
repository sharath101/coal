import { ENDPOINTS, type EndpointSpec, type PermissionKey } from '@coal/shared';
import { describe, expect, it } from 'vitest';
import type { Actor, RequestContext } from '../../core/http/context';
import { assertAiTier, guard } from '../../core/http/endpoint';
import { IMPLEMENTATIONS } from '../index';
import { ROLES } from '../org/catalogue';
import { canAccess, canUse } from './index';
import { RULES } from './rules';

/**
 * The permission test table (docs/roles-and-access.md#how-access-is-enforced): for every
 * permission, who is allowed. Everyone not listed is denied. A new endpoint needs a row here.
 */
type Who = string;
const ROLE_KEYS: Who[] = ROLES.map((r) => r.key);
const EVERYONE: Who[] = ['anonymous', ...ROLE_KEYS];
const SIGNED_IN: Who[] = ROLE_KEYS;

const ENDPOINT_TABLE: Record<PermissionKey, Who[]> = {
  'auth.signUp': EVERYONE,
  'auth.signIn': EVERYONE,
  'auth.signOut': SIGNED_IN,
  'me.read': SIGNED_IN,
  'me.update': SIGNED_IN,
  'users.read': SIGNED_IN,
  'org.read': EVERYONE,
  'rnd.productLines.read': EVERYONE,
  'files.upload': SIGNED_IN,
  'files.read': SIGNED_IN,
};

/** Record-level rules: for each case, which roles are allowed. */
const RESOURCE_TABLE = {
  'files.upload': { 'own upload': SIGNED_IN, "someone else's upload": [] as Who[] },
  'files.read': { 'own file': SIGNED_IN, "someone else's file": [] as Who[] },
} as const;

const actorFor = (who: Who, userId = 'user-1'): Actor | null =>
  who === 'anonymous' ? null : { userId, name: `A ${who}`, roleKey: who, productLineId: null };

describe('permission table', () => {
  it('covers every permission an endpoint uses, and every role', () => {
    const used = new Set(ENDPOINTS.map((e) => e.permission));
    expect(new Set(Object.keys(ENDPOINT_TABLE))).toEqual(used);
    expect(new Set(Object.keys(RULES))).toEqual(used);
  });

  const cases = Object.entries(ENDPOINT_TABLE).flatMap(([permission, allowed]) =>
    EVERYONE.map((who) => [permission as PermissionKey, who, allowed.includes(who)] as const),
  );

  it.each(cases)('%s by %s → allowed: %s', (permission, who, expected) => {
    expect(canUse(permission, actorFor(who)).allowed).toBe(expected);
  });

  const resourceCases = Object.entries(RESOURCE_TABLE).flatMap(([permission, byCase]) =>
    Object.entries(byCase).flatMap(([name, allowed]) =>
      ROLE_KEYS.map(
        (who) =>
          [permission as keyof typeof RESOURCE_TABLE, name, who, allowed.includes(who)] as const,
      ),
    ),
  );

  it.each(resourceCases)('%s on %s by %s → allowed: %s', (permission, name, who, expected) => {
    const actor = actorFor(who) as Actor;
    const uploadedBy = name.startsWith('own') ? actor.userId : 'someone-else';
    expect(canAccess(permission, actor, { uploadedBy }).allowed).toBe(expected);
  });

  it('names who can when it refuses, without revealing content', () => {
    const decision = canAccess('files.read', actorFor('vp') as Actor, { uploadedBy: 'x' });
    expect(decision).toEqual({
      allowed: false,
      code: 'NOT_ALLOWED',
      whoCan: ['The person who uploaded it'],
    });
  });
});

describe('endpoints', () => {
  it('each have exactly one implementation', () => {
    const implemented = IMPLEMENTATIONS.map((i) => i.endpoint.id).sort();
    expect(implemented).toEqual(ENDPOINTS.map((e) => e.id).sort());
  });
});

describe('AI tiers', () => {
  const ctx = (viaAi: boolean): RequestContext => ({
    orgId: 'org',
    requestId: 'req',
    actor: actorFor('rd_head'),
    sessionId: 's',
    viaAi,
  });
  const endpointWith = (aiTier: EndpointSpec['aiTier']): EndpointSpec => ({
    id: 'test.endpoint',
    method: 'POST',
    path: '/test',
    summary: 'test',
    auth: 'session',
    permission: 'me.read',
    aiTier,
  });

  it.each([
    ['read', true],
    ['auto', true],
    ['confirm', false],
    ['never', false],
    ['none', false],
  ] as const)('a "via AI" call to a %s endpoint → allowed: %s', (tier, allowed) => {
    const run = () => assertAiTier(endpointWith(tier), ctx(true));
    if (allowed) expect(run).not.toThrow();
    else expect(run).toThrow(expect.objectContaining({ code: 'AI_NOT_ALLOWED', status: 403 }));
  });

  it.each(['read', 'auto', 'confirm', 'never', 'none'] as const)(
    'a person calling a %s endpoint directly is not limited by the tier',
    (tier) => {
      expect(() => assertAiTier(endpointWith(tier), ctx(false))).not.toThrow();
    },
  );

  it('refuses signing in, signing up and editing the profile via AI', () => {
    for (const endpoint of ENDPOINTS.filter((e) => e.aiTier === 'none')) {
      expect(() => guard(endpoint, ctx(true))).toThrow(
        expect.objectContaining({ code: 'AI_NOT_ALLOWED' }),
      );
    }
  });
});
