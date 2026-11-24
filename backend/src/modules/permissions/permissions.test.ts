import { ENDPOINTS, type EndpointSpec, type PermissionKey } from '@coal/shared';
import { describe, expect, it } from 'vitest';
import type { Actor, RequestContext } from '../../core/http/context';
import { assertAiTier, guard } from '../../core/http/endpoint';
import { IMPLEMENTATIONS } from '../index';
import { POSITIONS, ROLES, firstPositionOfRole, type PositionSeed } from '../org/catalogue';
import { canAccess, canUse } from './index';
import {
  RULES,
  canSeeDrafts,
  causeNameVisible,
  documentAccess,
  howToGive,
  isAbove,
  type DocumentResource,
  type Person,
} from './rules';

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
  // Demo only (P113): only the admin behind a session can switch.
  'auth.switch': ['admin'],
  'me.read': SIGNED_IN,
  'me.update': SIGNED_IN,
  'users.read': SIGNED_IN,
  'org.read': EVERYONE,
  'org.chart': SIGNED_IN,
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
  'steps.remind': SIGNED_IN,
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
  'tasks.answer': SIGNED_IN,
  'documentTypes.read': SIGNED_IN,
  'templates.read': SIGNED_IN,
  // ⚠ The VP or the Head adds and activates templates (S6).
  'templates.write': ['vp', 'rd_head'],
  'templates.activate': ['vp', 'rd_head'],
  'documents.list': SIGNED_IN,
  'documents.read': SIGNED_IN,
  'documents.create': SIGNED_IN,
  'documents.write': SIGNED_IN,
  'documents.submit': SIGNED_IN,
  'signatures.read': SIGNED_IN,
  'signatures.sign': SIGNED_IN,
  'signatures.return': SIGNED_IN,
  'attachments.read': SIGNED_IN,
  'attachments.write': SIGNED_IN,
  'sources.read': SIGNED_IN,
  'sources.write': SIGNED_IN,
  'timeline.read': SIGNED_IN,
  'timeline.plan': SIGNED_IN,
  // ⚠ The Head changes dates; the VP too, and only the VP, if the launch moves (W13).
  'timeline.change': ['rd_head', 'vp'],
  'deviations.read': SIGNED_IN,
  'deviations.record': SIGNED_IN,
  'deviations.review': SIGNED_IN,
  'deviations.comment': SIGNED_IN,
  'notifications.read': SIGNED_IN,
  'notifications.markRead': SIGNED_IN,
  'notifications.markAllRead': SIGNED_IN,
  'widgets.read': SIGNED_IN,
  'proposals.create': SIGNED_IN,
  'proposals.list': SIGNED_IN,
  'proposals.read': SIGNED_IN,
  'proposals.write': SIGNED_IN,
  'search.read': SIGNED_IN,
  'ai.chats.create': SIGNED_IN,
  'ai.chats.list': SIGNED_IN,
  'ai.chats.read': SIGNED_IN,
  'ai.chats.write': SIGNED_IN,
  'ai.feedback': SIGNED_IN,
  'research.sources.read': SIGNED_IN,
  // ⚠ The VP, the Head and the Leads keep the source library; the people of steps C, 1 and 2 research (A11).
  'research.sources.write': ['vp', 'rd_head', 'rd_lead'],
  'research.run': ['vp', 'rd_head', 'rd_lead', 'rd_ops'],
  'research.read': SIGNED_IN,
  'research.write': SIGNED_IN,
};

/** Rules that need a project and the roles the route allows right now. */
const SCOPED = [
  'projects.team.write',
  'projects.hold',
  'projects.resume',
  'projects.drop',
  'steps.start',
  'steps.submit',
  'steps.remind',
  'steps.approve',
  'steps.return',
  'steps.decide',
  'steps.sendBack',
  'milestones.record',
  'correctiveActions.create',
  'tasks.reassign',
  'documents.create',
  'documents.write',
  'documents.submit',
  'attachments.write',
  'sources.write',
  'timeline.plan',
  'timeline.change',
] as const satisfies readonly PermissionKey[];
/** Roles that act on any project, whoever is on its team. */
const ANY_PROJECT: Who[] = ['board', 'vp', 'rd_head'];

/** Record-level rules: for each case, which roles are allowed. */
const RESOURCE_TABLE = {
  'files.upload': { 'own upload': SIGNED_IN, "someone else's upload": [] as Who[] },
  'files.read': { 'own file': SIGNED_IN, "someone else's file": [] as Who[] },
} as const;

/** A person in a role, in the first position of that role unless a test says otherwise. */
const actorIn = (
  roleKey: string,
  options: { userId?: string; positionKey?: string; line?: string | null } = {},
): Actor => ({
  userId: options.userId ?? 'user-1',
  name: roleKey,
  roleKey,
  positionKey: options.positionKey ?? firstPositionOfRole(roleKey)?.key ?? roleKey,
  productLineId: options.line ?? null,
  switcherId: roleKey === 'admin' ? (options.userId ?? 'user-1') : null,
});

const actorFor = (who: Who, userId = 'user-1'): Actor | null =>
  who === 'anonymous' ? null : actorIn(who, { userId });

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
      whoCan: ['The person who uploaded it', 'People who can see the record it belongs to'],
    });
  });

  it('names who can, in words, whenever an endpoint refuses a signed-in person', () => {
    // The AI repeats this to the person (docs/ai-safety.md#a-refusal-says-who-can-help-and-never-hints), so it
    // must always be there, and be a name a person reads, never a role key.
    for (const permission of Object.keys(ENDPOINT_TABLE) as PermissionKey[]) {
      for (const who of ROLE_KEYS) {
        const decision = canUse(permission, actorFor(who));
        if (decision.allowed) continue;
        expect(decision.code, `${permission} by ${who}`).toBe('NOT_ALLOWED');
        const names = decision.code === 'NOT_ALLOWED' ? decision.whoCan : [];
        expect(names.length, `${permission} by ${who} names no one`).toBeGreaterThan(0);
        for (const name of names)
          expect(name, `${permission} names a key`).not.toMatch(/^[a-z_]+$/);
      }
    }
  });

  it('names who can when a record is refused: for every scoped rule, for every role', () => {
    const resource = { productLineId: 'line-spine', memberIds: [], roles: ['rd_head'] };
    for (const permission of SCOPED) {
      for (const who of ROLE_KEYS) {
        const actor = actorIn(who);
        const decision = canAccess(permission, actor, resource);
        if (decision.allowed) continue;
        expect(
          decision.code === 'NOT_ALLOWED' && decision.whoCan.length,
          `${permission} by ${who}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('opens a file for anyone who may see a record that holds it', () => {
    const actor = actorFor('vp') as Actor;
    expect(canAccess('files.read', actor, { uploadedBy: 'x', viaRecord: true }).allowed).toBe(true);
    expect(canAccess('files.read', actor, { uploadedBy: null, viaRecord: false }).allowed).toBe(
      false,
    );
    // Finishing an upload stays with the uploader, whatever holds the file.
    expect(canAccess('files.upload', actor, { uploadedBy: 'x', viaRecord: true }).allowed).toBe(
      false,
    );
  });
});

describe('project-scoped rules', () => {
  const LINE = 'line-spine';
  const project = (memberIds: string[]) => ({ productLineId: LINE, memberIds });
  const actor = (who: Who, line: string | null = null): Actor => actorIn(who, { line });

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
      'given by me to someone else': {
        assigneeId: 'user-2',
        queueRole: null,
        assignedBy: 'user-1',
      },
    }[kind] as { assigneeId: string | null; queueRole: string | null; assignedBy?: string };
  };
  const TABLE = {
    'tasks.readOne': {
      'my task': true,
      "someone else's task": false,
      'queued for my role': true,
      'queued for another role': false,
      'given by me to someone else': true,
    },
    'tasks.update': {
      'my task': true,
      "someone else's task": false,
      'queued for my role': false,
      'queued for another role': false,
      'given by me to someone else': false,
    },
    'tasks.answer': {
      'my task': true,
      "someone else's task": false,
      'queued for my role': false,
      'queued for another role': false,
      'given by me to someone else': false,
    },
    'tasks.claim': {
      'my task': false,
      "someone else's task": false,
      'queued for my role': true,
      'queued for another role': false,
      'given by me to someone else': false,
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
    const lead = (line: string): Actor => actorIn('rd_lead', { line });
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

  it('links a new task to a project only for people who work on it', () => {
    const project = { productLineId: 'spine', memberIds: ['user-1'] };
    const pme = actorFor('pme') as Actor;
    expect(canAccess('tasks.create', pme, { project: null }).allowed).toBe(true);
    expect(canAccess('tasks.create', pme, { project }).allowed).toBe(true);
    expect(canAccess('tasks.create', pme, { project: { ...project, memberIds: [] } })).toEqual({
      allowed: false,
      code: 'NOT_ALLOWED',
      whoCan: ['Members of this project'],
    });
  });
});

describe('giving work: assignment or request (the org chart)', () => {
  const SPINE = 'line-spine';
  const TRAUMA = 'line-trauma';
  const seed = (key: string) => POSITIONS.find((p) => p.key === key) as PositionSeed;
  const at = (positionKey: string, line: string | null = null): Actor =>
    actorIn(seed(positionKey).role, { positionKey, line });
  const toward = (positionKey: string, line: string | null = null, id = 'user-2') => ({
    id,
    roleKey: seed(positionKey).role,
    positionKey,
    productLineId: line,
  });
  const give = (from: Actor, to: string, line: string | null = null, onLineTeam = false) =>
    howToGive(from, toward(to, line), onLineTeam);

  const RND_ROLES = [
    'rd_head',
    'rd_lead',
    'design_engineer',
    'aems',
    'pme',
    'rd_ops',
    'dard',
    'qc_inspector',
    'graphics_designer',
  ];
  const IN_RND = POSITIONS.filter((p) => RND_ROLES.includes(p.role)).map((p) => p.key);
  const OUTSIDE = ['company_qa', 'quality_control', 'production', 'marketing'];

  it('is my own task when I give it to myself', () => {
    for (const p of POSITIONS) {
      expect(howToGive(at(p.key), toward(p.key, null, 'user-1'), false)).toBe('own');
    }
  });

  it('lets the Board assign to the VP only', () => {
    for (const board of ['managing_director', 'ceo']) {
      expect(give(at(board), 'vp')).toBe('work');
      for (const to of [...IN_RND, ...OUTSIDE, 'managing_director', 'ceo']) {
        expect(give(at(board), to)).toBe('request');
      }
    }
  });

  it('lets the VP assign to anyone in R&D, and ask everyone else', () => {
    for (const to of IN_RND) expect(give(at('vp'), to)).toBe('work');
    for (const to of ['managing_director', 'ceo', ...OUTSIDE]) {
      expect(give(at('vp'), to)).toBe('request');
    }
  });

  it('lets the Head assign to anyone in R&D below them, and ask everyone else', () => {
    for (const to of IN_RND.filter((k) => k !== 'rd_head')) {
      expect(give(at('rd_head'), to)).toBe('work');
    }
    for (const to of ['vp', 'managing_director', 'ceo', ...OUTSIDE]) {
      expect(give(at('rd_head'), to)).toBe('request');
    }
  });

  it("lets a Lead assign to their line's design engineers, and to anyone in R&D on their line's project teams", () => {
    const lead = at('rd_lead', SPINE);
    expect(give(lead, 'design_engineer', SPINE)).toBe('work');
    expect(give(lead, 'design_engineer', TRAUMA)).toBe('request');
    for (const to of [
      'metallurgy_expert',
      'ops_manager',
      'dard_engineer',
      'qc_inspector',
      'pme_staff',
    ]) {
      expect(give(lead, to, null, true)).toBe('work');
      expect(give(lead, to, null, false)).toBe('request');
    }
    for (const to of ['rd_head', 'rd_lead', 'vp', ...OUTSIDE]) {
      expect(give(lead, to, TRAUMA, true)).toBe('request');
    }
  });

  it('lets each manager assign to the people who report to them', () => {
    expect(give(at('dard_lead'), 'dard_engineer')).toBe('work');
    expect(give(at('dard_lead'), 'qc_inspector')).toBe('work');
    expect(give(at('dard_lead'), 'design_engineer', SPINE)).toBe('request');
    expect(give(at('ops_manager'), 'ops_analyst')).toBe('work');
    expect(give(at('ops_manager'), 'graphics_designer')).toBe('work');
    expect(give(at('ops_manager'), 'dard_engineer')).toBe('request');
    expect(give(at('pme_manager'), 'pme_staff')).toBe('work');
    expect(give(at('pme_manager'), 'ops_analyst')).toBe('request');
  });

  it('makes everything from everyone else a request', () => {
    const everyoneElse = [
      'design_engineer',
      'metallurgy_expert',
      'fea_expert',
      'ops_analyst',
      'graphics_designer',
      'dard_engineer',
      'qc_inspector',
      'pme_staff',
      ...OUTSIDE,
    ];
    for (const from of everyoneElse) {
      for (const to of POSITIONS.map((p) => p.key)) {
        if (to !== from)
          expect(give(at(from, SPINE), to, SPINE, true), `${from} → ${to}`).toBe('request');
      }
    }
  });
});

describe('chat rules', () => {
  it.each(['ai.chats.read', 'ai.chats.write', 'ai.feedback'] as const)(
    '%s: only the person who started the chat, whatever their role',
    (permission) => {
      for (const who of ROLE_KEYS) {
        const actor = actorFor(who) as Actor;
        expect(canAccess(permission, actor, { userId: 'user-1' }).allowed).toBe(true);
        expect(canAccess(permission, actor, { userId: 'user-2' })).toEqual({
          allowed: false,
          code: 'NOT_ALLOWED',
          whoCan: ['The person who started the chat'],
        });
      }
    },
  );
});

describe('research run rules', () => {
  it.each(['research.read', 'research.write'] as const)(
    '%s: only the person who ran it, whatever their role',
    (permission) => {
      for (const who of ROLE_KEYS) {
        const actor = actorFor(who) as Actor;
        expect(canAccess(permission, actor, { userId: 'user-1' }).allowed).toBe(true);
        expect(canAccess(permission, actor, { userId: 'user-2' })).toEqual({
          allowed: false,
          code: 'NOT_ALLOWED',
          whoCan: ['The person who ran it'],
        });
      }
    },
  );
});

describe('proposal rules', () => {
  it.each(['proposals.read', 'proposals.write'] as const)(
    '%s: only the person it was prepared for',
    (permission) => {
      const actor = actorFor('vp') as Actor;
      expect(canAccess(permission, actor, { forUserId: 'user-1' }).allowed).toBe(true);
      expect(canAccess(permission, actor, { forUserId: 'user-2' })).toEqual({
        allowed: false,
        code: 'NOT_ALLOWED',
        whoCan: ['The person it was prepared for'],
      });
    },
  );
});

describe('template rules', () => {
  it.each(ROLE_KEYS)(
    '%s reads an active template; drafts and retired versions only for the VP and the Head',
    (who) => {
      const actor = actorFor(who) as Actor;
      expect(canAccess('templates.read', actor, { status: 'active' }).allowed).toBe(true);
      for (const status of ['draft', 'retired'] as const) {
        expect(canAccess('templates.read', actor, { status }).allowed).toBe(
          ['vp', 'rd_head'].includes(who),
        );
      }
    },
  );
});

describe('document access (need-to-know)', () => {
  const LINE = 'line-spine';
  const base: DocumentResource = {
    productLineId: LINE,
    memberIds: [],
    sensitivity: 'normal',
    boardPaper: false,
    checkpoint: false,
    addressedRoles: [],
    addressedUserIds: [],
  };
  const who = (
    roleKey: string,
    options: { line?: string; member?: boolean } = {},
  ): [Actor, string[]] => [
    actorIn(roleKey, { line: options.line ?? null }),
    options.member ? ['user-1'] : [],
  ];
  const access = (
    [actor, memberIds]: [Actor, string[]],
    resource: Partial<DocumentResource> = {},
  ) => documentAccess(actor, { ...base, memberIds, ...resource });

  it('gives a normal document to the VP, the Head, the Lead of its line and the team, and to no one else', () => {
    expect(access(who('vp'))).toBe('full');
    expect(access(who('rd_head'))).toBe('full');
    expect(access(who('rd_lead', { line: LINE }))).toBe('full');
    expect(access(who('rd_lead', { line: 'line-trauma' }))).toBe('none');
    expect(access(who('design_engineer', { member: true }))).toBe('full');
    expect(access(who('design_engineer'))).toBe('none');
    expect(access(who('board'))).toBe('none');
    expect(access(who('company_qa'))).toBe('none');
    expect(access(who('marketing'))).toBe('none');
  });

  it('gives the Board checkpoint papers only', () => {
    expect(access(who('board'), { checkpoint: true })).toBe('full');
    expect(access(who('board'), { checkpoint: false })).toBe('none');
  });

  it('gives a Board paper to the Board, the VP and the Head, and only its outcome to the Lead', () => {
    const paper = { boardPaper: true, checkpoint: true };
    expect(access(who('board'), paper)).toBe('full');
    expect(access(who('vp'), paper)).toBe('full');
    expect(access(who('rd_head'), paper)).toBe('full');
    expect(access(who('rd_lead', { line: LINE }), paper)).toBe('outcome');
    expect(access(who('rd_lead', { line: 'line-trauma' }), paper)).toBe('none');
    expect(access(who('design_engineer', { member: true }), paper)).toBe('none');
  });

  it('keeps budget figures to the Board, the VP, the Head, the Lead of the line and R&D Ops on the project', () => {
    const budget = { sensitivity: 'budget' as const };
    expect(access(who('board'), budget)).toBe('full');
    expect(access(who('vp'), budget)).toBe('full');
    expect(access(who('rd_head'), budget)).toBe('full');
    expect(access(who('rd_lead', { line: LINE }), budget)).toBe('full');
    expect(access(who('rd_lead', { line: 'line-trauma' }), budget)).toBe('none');
    expect(access(who('rd_ops', { member: true }), budget)).toBe('full');
    expect(access(who('rd_ops'), budget)).toBe('none');
    expect(access(who('design_engineer', { member: true }), budget)).toBe('none');
    expect(access(who('dard', { member: true }), budget)).toBe('none');
  });

  it('lets signers read what they are asked to sign', () => {
    // By role: an outside role anywhere; an R&D role only where it is in the project's scope.
    expect(access(who('company_qa'), { addressedRoles: ['company_qa'] })).toBe('full');
    expect(access(who('dard'), { addressedRoles: ['dard'] })).toBe('none');
    expect(access(who('dard', { member: true }), { addressedRoles: ['dard'] })).toBe('full');
    // By name, wherever they are.
    expect(access(who('dard'), { addressedUserIds: ['user-1'] })).toBe('full');
    // Even a budget annex or a Board paper.
    expect(
      access(who('company_qa'), { addressedRoles: ['company_qa'], sensitivity: 'budget' }),
    ).toBe('full');
  });

  it('shows drafts only to the people who work on the project', () => {
    const scope = { productLineId: LINE, memberIds: ['user-1'] };
    const draftsFor = (roleKey: string, line: string | null = null, member = false) =>
      canSeeDrafts(who(roleKey, { line: line ?? undefined })[0], {
        ...scope,
        memberIds: member ? ['user-1'] : [],
      });
    expect(draftsFor('vp')).toBe(true);
    expect(draftsFor('rd_head')).toBe(true);
    expect(draftsFor('rd_lead', LINE)).toBe(true);
    expect(draftsFor('design_engineer', null, true)).toBe(true);
    expect(draftsFor('board')).toBe(false);
    expect(draftsFor('company_qa')).toBe(false);
    expect(draftsFor('design_engineer')).toBe(false);
  });

  it('names who can when it refuses, without revealing the content', () => {
    const decision = canAccess('documents.read', who('design_engineer')[0], {
      ...base,
      sensitivity: 'budget',
    });
    expect(decision).toEqual({
      allowed: false,
      code: 'NOT_ALLOWED',
      whoCan: [
        'Board',
        'VP',
        'R&D Head',
        'The R&D Lead of this product line',
        'R&D Ops on the project',
      ],
    });
  });
});

describe('signature rows', () => {
  const row = (roleKeys: string[], assigneeId: string | null = null) => ({
    productLineId: 'line-spine',
    memberIds: [] as string[],
    roleKeys,
    assigneeId,
  });
  const as = (roleKey: string): Actor =>
    actorIn(roleKey, { line: roleKey === 'rd_lead' ? 'line-spine' : null });
  const reach = (actor: Actor, r: ReturnType<typeof row>, member = false) =>
    canAccess('signatures.sign', actor, { ...r, memberIds: member ? ['user-1'] : [] }).allowed;

  it('lets the named person sign, and no one else', () => {
    expect(reach(as('vp'), row(['vp'], 'user-1'))).toBe(true);
    expect(reach(as('vp'), row(['vp'], 'user-2'))).toBe(false);
  });

  it('lets anyone with the asked role sign, within the project’s scope', () => {
    expect(reach(as('vp'), row(['vp']))).toBe(true);
    expect(reach(as('rd_head'), row(['vp']))).toBe(false);
    expect(reach(as('dard'), row(['dard']))).toBe(false);
    expect(reach(as('dard'), row(['dard']), true)).toBe(true);
    expect(reach(as('company_qa'), row(['company_qa']))).toBe(true);
    // Reviewers may be asked as any one of several roles.
    expect(reach(as('rd_lead'), row(['dard', 'rd_lead']))).toBe(true);
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

  it('lets only auto and confirm endpoints go on an action card, and only the person confirm one', () => {
    const proposable = IMPLEMENTATIONS.filter((i) => i.describe).map((i) => i.endpoint);
    expect(proposable.map((e) => e.id)).toEqual(
      expect.arrayContaining(['tasks.create', 'tasks.reassign', 'deviations.record']),
    );
    for (const e of proposable) expect(['auto', 'confirm']).toContain(e.aiTier);
    for (const id of ['proposals.confirm', 'proposals.reject']) {
      expect(ENDPOINTS.find((e) => e.id === id)?.aiTier).toBe('never');
    }
  });
});

describe('deviation and notification rules', () => {
  const LINE = 'line-spine';
  const scope = { productLineId: LINE, memberIds: ['user-1'] };
  const as = (
    roleKey: string,
    userId = 'user-1',
    line: string | null = null,
    positionKey?: string,
  ): Actor => actorIn(roleKey, { userId, line, ...(positionKey && { positionKey }) });
  const placed = (positionKey: string, line: string | null = null): Person => ({
    positionKey,
    roleKey: POSITIONS.find((p) => p.key === positionKey)?.role as string,
    productLineId: line,
  });

  it('knows the chart: MD → VP → Head → Lead → designers, and the managers under the Head', () => {
    const above = (
      a: string,
      b: string,
      aLine: string | null = null,
      bLine: string | null = null,
    ) => isAbove(placed(a, aLine), placed(b, bLine), false);
    expect(above('rd_lead', 'design_engineer', 'spine', 'spine')).toBe(true);
    expect(above('rd_lead', 'design_engineer', 'spine', 'trauma')).toBe(false);
    expect(above('rd_head', 'design_engineer', null, 'trauma')).toBe(true);
    expect(above('vp', 'rd_lead', null, 'spine')).toBe(true);
    expect(above('managing_director', 'vp')).toBe(true);
    expect(above('ceo', 'vp')).toBe(true);
    expect(above('design_engineer', 'rd_lead', 'spine', 'spine')).toBe(false);
    expect(above('rd_lead', 'rd_lead', 'spine', 'spine')).toBe(false);
    expect(above('rd_lead', 'company_qa', 'spine')).toBe(false);
    expect(above('dard_lead', 'qc_inspector')).toBe(true);
    expect(above('dard_lead', 'dard_engineer')).toBe(true);
    expect(above('ops_manager', 'graphics_designer')).toBe(true);
    expect(above('rd_head', 'pme_staff')).toBe(true);
    expect(above('pme_manager', 'ops_analyst')).toBe(false);
    expect(above('admin', 'vp')).toBe(false);
    expect(above('vp', 'admin')).toBe(false);
  });

  it('puts a Lead above the R&D staff on their line projects, as the Lead runs them', () => {
    const lead = placed('rd_lead', 'spine');
    expect(isAbove(lead, placed('pme_staff'), true)).toBe(true);
    expect(isAbove(lead, placed('pme_staff'), false)).toBe(false);
    expect(isAbove(lead, placed('rd_head'), true)).toBe(false);
    expect(isAbove(lead, placed('company_qa'), true)).toBe(false);
  });

  const record = (actor: Actor, assigneeId: string | null) =>
    canAccess('deviations.record', actor, { ...scope, assigneeId }).allowed;

  it('lets the assignee, the Lead of the line and the Head record a deviation', () => {
    expect(record(as('pme', 'user-1'), 'user-1')).toBe(true);
    expect(record(as('pme', 'user-2'), 'user-1')).toBe(false);
    expect(record(as('rd_lead', 'user-9', LINE), 'user-1')).toBe(true);
    expect(record(as('rd_lead', 'user-9', 'line-trauma'), 'user-1')).toBe(false);
    expect(record(as('rd_head', 'user-9'), 'user-1')).toBe(true);
    expect(record(as('vp', 'user-9'), 'user-1')).toBe(false);
    expect(record(as('company_qa', 'user-9'), 'user-1')).toBe(false);
  });

  const review = (actor: Actor, recorder: Person, recordedById = 'user-1') =>
    canAccess('deviations.review', actor, { ...scope, recorder, recordedById });
  const staff = placed('pme_staff');
  const designer = placed('design_engineer', LINE);

  it('lets someone above the recorder on the chart, or the Lead of the line, confirm; never the person who recorded it', () => {
    expect(review(as('rd_lead', 'user-9', LINE), staff).allowed).toBe(true);
    expect(review(as('rd_lead', 'user-9', LINE), designer).allowed).toBe(true);
    expect(review(as('pme', 'user-1', null, 'pme_manager'), staff, 'user-5').allowed).toBe(true);
    expect(review(as('rd_head', 'user-9'), staff).allowed).toBe(true);
    expect(review(as('vp', 'user-9'), placed('rd_lead', LINE)).allowed).toBe(true);
    expect(review(as('pme', 'user-9', null, 'pme_staff'), staff).allowed).toBe(false);
    expect(review(as('rd_lead', 'user-9', LINE), placed('rd_lead', LINE)).allowed).toBe(false);
    expect(review(as('rd_head', 'user-1'), staff, 'user-1').allowed).toBe(false);
    expect(review(as('rd_lead', 'user-9', 'line-trauma'), staff).allowed).toBe(false);
    expect(review(as('dard', 'user-9', null, 'dard_lead'), placed('qc_inspector')).allowed).toBe(
      false,
    );
  });

  it('lets a manager confirm for the people who report to them when they are on the project', () => {
    expect(
      canAccess('deviations.review', as('dard', 'user-1', null, 'dard_lead'), {
        ...scope,
        recorder: placed('qc_inspector'),
        recordedById: 'user-5',
      }).allowed,
    ).toBe(true);
  });

  it('names who can confirm when a review is refused', () => {
    expect(review(as('pme', 'user-9', null, 'pme_staff'), staff)).toEqual({
      allowed: false,
      code: 'NOT_ALLOWED',
      whoCan: ['Asst. Manager, PME', 'The R&D Lead of this product line'],
    });
    expect(review(as('rd_head', 'user-9'), placed('managing_director'))).toEqual({
      allowed: false,
      code: 'NOT_ALLOWED',
      whoCan: ['Nobody: it is at the top of the line'],
    });
  });

  const comment = (actor: Actor, cause: { causeUserId: string | null; causeRole: string | null }) =>
    canAccess('deviations.comment', actor, { ...scope, ...cause }).allowed;

  it('lets only the person or role named as the cause comment', () => {
    expect(comment(as('dard', 'user-5'), { causeUserId: 'user-5', causeRole: null })).toBe(true);
    expect(comment(as('dard', 'user-6'), { causeUserId: 'user-5', causeRole: null })).toBe(false);
    expect(comment(as('vp', 'user-6'), { causeUserId: 'user-5', causeRole: null })).toBe(false);
    expect(comment(as('dard', 'user-1'), { causeUserId: null, causeRole: 'dard' })).toBe(true);
    expect(comment(as('pme', 'user-1'), { causeUserId: null, causeRole: 'dard' })).toBe(false);
  });

  const named = (actor: Actor, userId: string | null, user: Person | null) =>
    causeNameVisible(actor, { userId, user, ...scope });

  it('shows who caused a delay only to the VP, the Head, the people above them, and the person', () => {
    expect(named(as('vp', 'user-9'), 'user-5', staff)).toBe(true);
    expect(named(as('rd_head', 'user-9'), 'user-5', staff)).toBe(true);
    expect(named(as('rd_lead', 'user-9', LINE), 'user-5', staff)).toBe(true);
    expect(named(as('rd_lead', 'user-9', 'line-trauma'), 'user-5', staff)).toBe(false);
    expect(named(as('rd_lead', 'user-9', LINE), 'user-5', placed('rd_head'))).toBe(false);
    expect(named(as('pme', 'user-5'), 'user-5', staff)).toBe(true);
    expect(named(as('pme', 'user-6'), 'user-5', staff)).toBe(false);
    expect(named(as('pme', 'user-1', null, 'pme_manager'), 'user-5', staff)).toBe(true);
    expect(named(as('board', 'user-9'), 'user-5', staff)).toBe(false);
    expect(named(as('company_qa', 'user-9'), 'user-5', staff)).toBe(false);
  });

  it('opens a notification only for the person it was sent to', () => {
    expect(
      canAccess('notifications.markRead', as('pme', 'user-1'), { userId: 'user-1' }).allowed,
    ).toBe(true);
    expect(
      canAccess('notifications.markRead', as('vp', 'user-2'), { userId: 'user-1' }).allowed,
    ).toBe(false);
  });
});
