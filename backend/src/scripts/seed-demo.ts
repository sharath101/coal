/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- a dev script that reads the API's JSON as the tests do */
import { addCalendarDays, dateOfInstant } from '@coal/shared';
import { buildApp } from '../app';
import { createRuntime } from '../runtime';
import { OutboxDispatcher } from '../modules/events/dispatcher';
import { SUBSCRIPTIONS } from '../modules/events/subscriptions';
import { recomputeAll } from '../modules/schedule/nightly';

/**
 * Local demo data: made-up people and three projects in different states, so every widget has
 * something to show (docs/dashboard.md). Run it once on an empty development database:
 *
 *   pnpm --filter @coal/backend seed:demo
 *
 * The past is made by moving the clock back while the steps are walked through, then restoring it.
 */
const runtime = await createRuntime();
let daysAhead = 0;
runtime.deps.now = () => new Date(Date.now() + daysAhead * 86_400_000);
const app = await buildApp(runtime.deps);
const orgId = runtime.deps.config.orgId;

const PEOPLE = {
  vp: ['Vera Demo', 'vp'],
  head: ['Hari Demo', 'rd_head'],
  lead: ['Leela Demo', 'rd_lead', 'SPN'],
  leadT: ['Lena Demo', 'rd_lead', 'TRM'],
  designer: ['Dev Demo', 'design_engineer'],
  aems: ['Asha Demo', 'aems'],
  pme: ['Pia Demo', 'pme'],
  ops: ['Om Demo', 'rd_ops'],
  dard: ['Dina Demo', 'dard'],
  qc: ['Quin Demo', 'qc_inspector'],
  md: ['Mira Demo', 'board'],
  ceo: ['Chet Demo', 'board'],
  qa: ['Quill Demo', 'company_qa'],
  marketing: ['Olive Demo', 'marketing'],
} as const;

type Key = keyof typeof PEOPLE;
const cookies = new Map<string, string>();
const ids = new Map<string, string>();

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  as: Key | null,
  payload?: unknown,
) {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: as ? { cookie: cookies.get(as) as string } : {},
    ...(payload !== undefined && { payload: payload as object }),
  });
  const body = res.body ? res.json() : null;
  if (res.statusCode >= 300)
    throw new Error(`${method} ${url} as ${as}: ${res.statusCode} ${res.body}`);
  return { body, cookie: res.cookies.find((c) => c.name === 'coal_session')?.value };
}

const lines = new Map<string, string>(
  ((await call('GET', '/product-lines', null)).body.items as { id: string; code: string }[]).map(
    (l) => [l.code, l.id],
  ),
);

for (const [key, [name, roleKey, line]] of Object.entries(PEOPLE) as [
  Key,
  readonly [string, string, string?],
][]) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-up',
    payload: { name, roleKey, ...(line && { productLineId: lines.get(line) }) },
  });
  if (res.statusCode === 409) {
    console.log(
      `${name} already exists: this database has demo data. Reset it first (docker compose down -v).`,
    );
    process.exit(1);
  }
  if (res.statusCode !== 201)
    throw new Error(`Could not add ${name}: ${res.statusCode} ${res.body}`);
  cookies.set(key, `coal_session=${res.cookies.find((c) => c.name === 'coal_session')?.value}`);
  ids.set(key, res.json().user.id);
}

const today = () => dateOfInstant(runtime.deps.now());
const on = (offset: number) => addCalendarDays(dateOfInstant(new Date()), offset);
const COOKIE_OF_ROLE: Record<string, (line: 'SPN' | 'TRM') => Key> = {
  vp: () => 'vp',
  rd_head: () => 'head',
  rd_lead: (line) => (line === 'SPN' ? 'lead' : 'leadT'),
  design_engineer: () => 'designer',
  aems: () => 'aems',
  pme: () => 'pme',
  rd_ops: () => 'ops',
  dard: () => 'dard',
  qc_inspector: () => 'qc',
};

const go = async (name: string, line: 'SPN' | 'TRM', team: Key[]) =>
  (
    await call('POST', '/projects', 'vp', {
      name,
      productLineId: lines.get(line),
      teamUserIds: team.map((k) => ids.get(k)),
    })
  ).body.project.id as string;

const stepOf = async (id: string, key: string) =>
  ((await call('GET', `/projects/${id}/route`, 'vp')).body.steps as any[]).find(
    (s) => s.key === key,
  );

async function submit(id: string, key: string, line: 'SPN' | 'TRM') {
  const step = await stepOf(id, key);
  await call(
    'POST',
    `/projects/${id}/steps/${key}/submit`,
    COOKIE_OF_ROLE[step.doers[0].key]!(line),
  );
  return step;
}

async function approve(id: string, key: string, line: 'SPN' | 'TRM') {
  const step = await stepOf(id, key);
  if (!step.signer) return;
  for (const as of step.signer.key === 'board'
    ? (['md', 'ceo'] as Key[])
    : [COOKIE_OF_ROLE[step.signer.key]!(line)]) {
    await call('POST', `/projects/${id}/steps/${key}/approve`, as);
  }
}

async function finish(id: string, key: string, line: 'SPN' | 'TRM') {
  await submit(id, key, line);
  await approve(id, key, line);
}

const TEAM: Key[] = ['designer', 'aems', 'pme', 'ops', 'dard', 'qc'];

// 1. A Spine project, 50 days in: the Action Plan is signed, and two design steps are late.
daysAhead = -50;
const plate = await go('Anterior cervical plate', 'SPN', TEAM);
for (const key of ['1', '2', '2a', '3']) {
  daysAhead += 1;
  await finish(plate, key, 'SPN');
}
daysAhead = -44;
await finish(plate, '4', 'SPN');
daysAhead = -43;
const span = (from: number, to: number, stepKey: string, roles: string[]) =>
  roles.map((roleKey) => ({ stepKey, roleKey, plannedStart: on(from), plannedEnd: on(to) }));
await call('PUT', `/projects/${plate}/timeline/plan`, 'lead', {
  items: [
    ...span(-42, -30, '6', ['rd_lead', 'rd_ops', 'dard']),
    ...span(-42, -18, '7', ['design_engineer', 'aems']),
    ...span(-42, -25, '8', ['design_engineer', 'aems']),
    ...span(-29, -15, '9', ['rd_lead', 'rd_ops', 'dard']),
    ...span(100, 110, '25', ['vp']),
  ],
});
daysAhead = -42;
await finish(plate, '5', 'SPN');
daysAhead = -31;
await finish(plate, '6', 'SPN');

// Step 7 is late, and its designer has explained why; the Lead confirmed it.
daysAhead = -20;
const designTask =
  (await stepOf(plate, '7')).tasks.find((t: any) => t.assignee?.name === 'Dev Demo') ??
  (await stepOf(plate, '7')).tasks[0];
const deviation = (
  await call('POST', '/deviations', 'designer', {
    taskId: designTask.id,
    reasonCode: 'vendor_delay',
    reasonText: 'The casting vendor sent the sample plates late.',
    causeType: 'outside',
    causeParty: 'A made-up casting vendor',
    newDate: on(3),
  })
).body;
daysAhead = -19;
await call('POST', `/deviations/${deviation.id}/review`, 'lead', {
  outcome: 'confirmed',
  note: 'Agreed.',
});

// 2. A Trauma project that started today.
daysAhead = 0;
await go('Tibial nail, 11 mm', 'TRM', ['designer', 'pme', 'ops', 'dard']);

// 3. A Spine project at the Board checkpoint, waiting for two signatures.
daysAhead = -12;
const cage = await go('Interbody cage, PEEK', 'SPN', TEAM);
for (const key of ['1', '2', '2a', '3']) {
  daysAhead += 1;
  await finish(cage, key, 'SPN');
}
daysAhead = -7;
await submit(cage, '4', 'SPN');

daysAhead = 0;
const worked = await recomputeAll(runtime.deps, orgId);
// The messages for what happened in the past are delivered now and marked as read: the bell starts
// empty, and fills as you act.
await new OutboxDispatcher(runtime.deps.db, SUBSCRIPTIONS).drain();
for (const key of Object.keys(PEOPLE) as Key[]) await call('POST', '/notifications/read-all', key);
console.log(
  `Made ${Object.keys(PEOPLE).length} people and 3 projects (${worked} schedules worked out).`,
);
console.log(
  'Sign in by name: ' +
    Object.values(PEOPLE)
      .map(([name, role]) => `${name} (${role})`)
      .join(', '),
);
console.log(`Dates today: ${today()}`);
await app.close();
await runtime.pool.end();
