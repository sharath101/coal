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
  'processes.read': SIGNED_IN,
  'projects.read': SIGNED_IN,
  // ⚠ Only the VP creates projects (A5).
  'projects.create': ['vp'],
  'projects.team.write': ['rd_head', 'rd_lead'],
  'projects.hold': ['vp'],
  'projects.resume': ['vp'],
  'projects.drop': ['vp', 'board'],
  'steps.start': SIGNED_IN,
  'steps.submit': SIGNED_IN,
  'steps.approve': SIGNED_IN,
  'steps.return': SIGNED_IN,
  'steps.decide': SIGNED_IN,
  'steps.sendBack': SIGNED_IN,
  'milestones.record': SIGNED_IN,
  'correctiveActions.create': ['rd_lead'],
  'tasks.read': SIGNED_IN,
  'tasks.readOne': SIGNED_IN,
  'tasks.update': SIGNED_IN,
  'tasks.claim': SIGNED_IN,
  'tasks.reassign': ['vp', 'rd_head', 'rd_lead'],
  'tasks.create': SIGNED_IN,
  'ai.models.read': SIGNED_IN,
  'ai.chats.read': SIGNED_IN,
  'ai.chats.write': SIGNED_IN,
  'ai.proposals.decide': SIGNED_IN,
  'ai.drafts.read': SIGNED_IN,
};

/** Rules that need a project and the roles the route allows right now. */
const SCOPED = [
  'projects.team.write',
  'projects.hold',
  'projects.resume',
  'projects.drop',
  'steps.start',
  'steps.submit',
  'steps.approve',
  'steps.return',
  'steps.decide',
  'steps.sendBack',
  'milestones.record',
  'correctiveActions.create',
  'tasks.reassign',
] as const satisfies readonly PermissionKey[];
/** Roles that act on any project, whoever is on its team. */
const ANY_PROJECT: Who[] = ['board', 'vp', 'rd_head'];

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

describe('the assistant: only your own chats, cards and drafts', () => {
  const OWNED = [
    'ai.chats.read',
    'ai.chats.write',
    'ai.proposals.decide',
    'ai.drafts.read',
  ] as const;
  const cases = OWNED.flatMap((permission) =>
    ROLE_KEYS.flatMap(
      (who) =>
        [
          [permission, who, 'own', true],
          [permission, who, "someone else's", false],
        ] as const,
    ),
  );

  it.each(cases)('%s by %s on %s → allowed: %s', (permission, who, whose, expected) => {
    const actor = actorFor(who) as Actor;
    const ownerId = whose === 'own' ? actor.userId : 'someone-else';
    expect(canAccess(permission, actor, { ownerId }).allowed).toBe(expected);
  });
});

describe('project-scoped rules', () => {
  const LINE = 'line-spine';
  const project = (memberIds: string[]) => ({ productLineId: LINE, memberIds });
  const actor = (who: Who, line: string | null = null): Actor => ({
    userId: 'user-1',
    name: `A ${who}`,
    roleKey: who,
    productLineId: line,
  });

  const cases = SCOPED.flatMap((permission) =>
    ROLE_KEYS.flatMap(
      (who) =>
        [
          [permission, who, 'a team member', true],
          [permission, who, 'someone not on the project', ANY_PROJECT.includes(who)],
          [permission, who, 'a Lead of another product line', ANY_PROJECT.includes(who)],
        ] as const,
    ),
  );

  it.each(cases)(
    '%s by %s as %s, when the route allows their role → allowed: %s',
    (permission, who, as, expected) => {
      const member = as === 'a team member';
      const line = as === 'a Lead of another product line' ? 'line-trauma' : null;
      const resource = { ...project(member ? ['user-1'] : []), roles: [who] };
      expect(canAccess(permission, actor(who, line), resource).allowed).toBe(expected);
    },
  );

  it.each(SCOPED)(
    '%s: a Lead of the same product line may act without being on the team',
    (permission) => {
      const resource = { ...project([]), roles: ['rd_lead'] };
      expect(canAccess(permission, actor('rd_lead', LINE), resource).allowed).toBe(true);
    },
  );

  const wrongRole = SCOPED.flatMap((permission) =>
    ROLE_KEYS.filter((who) => who !== 'rd_head').map((who) => [permission, who] as const),
  );
  it.each(wrongRole)(
    '%s by %s when the route allows only the Head → denied, and names the Head',
    (permission, who) => {
      const resource = { ...project(['user-1']), roles: ['rd_head'] };
      expect(canAccess(permission, actor(who, LINE), resource)).toEqual({
        allowed: false,
        code: 'NOT_ALLOWED',
        whoCan: ['R&D Head'],
      });
    },
  );

  it('lets the project team in where the route names "team"', () => {
    const asMember = canAccess('steps.submit', actor('pme'), {
      ...project(['user-1']),
      roles: ['team'],
    });
    const asOutsider = canAccess('steps.submit', actor('pme'), { ...project([]), roles: ['team'] });
    expect(asMember.allowed).toBe(true);
    expect(asOutsider.allowed).toBe(false);
  });
});

describe('task rules', () => {
  const taskFor = (who: Who, kind: string) => {
    const other = who === 'pme' ? 'dard' : 'pme';
    return {
      'my task': { assigneeId: 'user-1', queueRole: null },
      "someone else's task": { assigneeId: 'user-2', queueRole: null },
      'queued for my role': { assigneeId: null, queueRole: who },
      'queued for another role': { assigneeId: null, queueRole: other },
    }[kind] as { assigneeId: string | null; queueRole: string | null };
  };
  const TABLE = {
    'tasks.readOne': {
      'my task': true,
      "someone else's task": false,
      'queued for my role': true,
      'queued for another role': false,
    },
    'tasks.update': {
      'my task': true,
      "someone else's task": false,
      'queued for my role': false,
      'queued for another role': false,
    },
    'tasks.claim': {
      'my task': false,
      "someone else's task": false,
      'queued for my role': true,
      'queued for another role': false,
    },
  } as const;
  const cases = Object.entries(TABLE).flatMap(([permission, byCase]) =>
    Object.entries(byCase).flatMap(([name, expected]) =>
      ROLE_KEYS.map((who) => [permission as keyof typeof TABLE, name, who, expected] as const),
    ),
  );

  it.each(cases)('%s on %s by %s → allowed: %s', (permission, name, who, expected) => {
    const task = { ...taskFor(who, name), productLineId: null };
    expect(canAccess(permission, actorFor(who) as Actor, task).allowed).toBe(expected);
  });

  it('claiming from the Lead queue needs the same product line as the project', () => {
    const queued = { assigneeId: null, queueRole: 'rd_lead' };
    const lead = (line: string): Actor => ({
      userId: 'user-1',
      name: 'A lead',
      roleKey: 'rd_lead',
      productLineId: line,
    });
    const spineTask = { ...queued, productLineId: 'spine' };
    expect(canAccess('tasks.claim', lead('spine'), spineTask).allowed).toBe(true);
    expect(canAccess('tasks.claim', lead('trauma'), spineTask)).toEqual({
      allowed: false,
      code: 'NOT_ALLOWED',
      whoCan: ['The R&D Lead of this product line'],
    });
    // Other roles aren't tied to a product line: the queue is their own role's.
    const dard = actorFor('dard') as Actor;
    const dardTask = { assigneeId: null, queueRole: 'dard', productLineId: 'spine' };
    expect(canAccess('tasks.claim', dard, dardTask).allowed).toBe(true);
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

  it('refuses signing in, signing up, signing off and every other endpoint the AI may not use', () => {
    const closed = ENDPOINTS.filter((e) => ['none', 'never', 'confirm'].includes(e.aiTier));
    expect(closed.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        'auth.signIn',
        'projects.create',
        'steps.approve',
        'steps.sendBack',
        'steps.submit',
      ]),
    );
    for (const endpoint of closed) {
      expect(() => guard(endpoint, ctx(true))).toThrow(
        expect.objectContaining({ code: 'AI_NOT_ALLOWED' }),
      );
    }
  });
});
