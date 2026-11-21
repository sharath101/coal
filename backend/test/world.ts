import { productLineId, signUp, type SignedIn, type TestApp } from './helpers';

/** The made-up people of the tests: one for each role the route uses. */
export const PEOPLE = {
  vp: ['Vera Example', 'vp'],
  head: ['Hari Example', 'rd_head'],
  head2: ['Hana Example', 'rd_head'],
  lead: ['Leela Example', 'rd_lead'],
  leadOther: ['Lena Example', 'rd_lead'],
  designer: ['Dev Example', 'design_engineer'],
  aems: ['Asha Example', 'aems'],
  pme: ['Pia Example', 'pme'],
  ops: ['Om Example', 'rd_ops'],
  dard: ['Dina Example', 'dard'],
  qc: ['Quin Example', 'qc_inspector'],
  md: ['Mira Example', 'board'],
  ceo: ['Chet Example', 'board'],
  qa: ['Quinn Example', 'company_qa'],
  outsider: ['Olga Example', 'marketing'],
} as const;

export interface Res {
  status: number;
  body: any;
}

const COOKIE_OF_ROLE: Record<string, string> = {
  vp: 'vp',
  rd_head: 'head',
  rd_lead: 'lead',
  design_engineer: 'designer',
  aems: 'aems',
  pme: 'pme',
  rd_ops: 'ops',
  dard: 'dard',
  qc_inspector: 'qc',
};

/** The documents a step needs before it can be submitted: its normal template types. */
const STEP_DOCUMENTS: Record<string, string[]> = {
  '1': ['PID'],
  '2': ['MRS'],
  '2a': ['REG_PLAN'],
  '3': ['PROJECT_PLANNING', 'APPROVAL_FORM'],
  '5': ['ACTION_PLAN'],
};

type Call = (
  method: 'GET' | 'POST',
  url: string,
  as: string | null,
  payload?: unknown,
) => Promise<Res>;

/**
 * Calls the tests share for documents: a finished upload, as COAL sees it (made through the real
 * upload flow), and `attach`, which uploads a made-up file as each document a step still needs
 * before it can be submitted, as the step's first doer.
 */
export function documentCalls(call: Call, ok: (res: Promise<Res>) => Promise<any>) {
  async function upload(
    as: string,
    name: string,
    bytes: Uint8Array,
    origin: 'internal' | 'outside' = 'internal',
  ): Promise<string> {
    const start = await ok(
      call('POST', '/files/upload-url', as, { name, size: bytes.length, origin }),
    );
    const put = await fetch(start.upload.url, {
      method: 'PUT',
      headers: start.upload.headers,
      body: bytes,
    });
    if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
    await ok(call('POST', `/files/${start.file.id}/complete`, as));
    return start.file.id;
  }

  async function attach(id: string, key: string) {
    const route = await ok(call('GET', `/projects/${id}/route`, 'vp'));
    const step = route.steps.find((s: { key: string }) => s.key === key);
    if (step.documentNeeds.length === 0) return;
    const as = COOKIE_OF_ROLE[step.doers[0].key]!;
    const made = await ok(call('GET', `/projects/${id}/documents?step=${key}`, as));
    const have = made.items.map((d: { type: { code: string } }) => d.type.code);
    for (const code of (STEP_DOCUMENTS[key] ?? []).filter((c) => !have.includes(c))) {
      const bytes = new TextEncoder().encode(`%PDF-1.4 made-up ${code} for step ${key} of ${id}`);
      const fileId = await upload(as, `${code}.pdf`, bytes);
      await ok(
        call('POST', `/projects/${id}/documents`, as, {
          stepKey: key,
          documentType: code,
          fileId,
        }),
      );
    }
  }

  return { upload, attach };
}

const ORDER = [
  '1',
  '2',
  '2a',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
];

/** Signs up the people and gives the tests the calls they need to walk a project through the route. */
export async function createWorld(t: TestApp) {
  const spine = await productLineId(t.app, 'SPN');
  const trauma = await productLineId(t.app, 'TRM');
  const who: Record<string, SignedIn> = {};
  for (const [key, [name, roleKey]] of Object.entries(PEOPLE)) {
    who[key] = await signUp(t.app, {
      name,
      roleKey,
      ...(roleKey === 'rd_lead' && { productLineId: key === 'leadOther' ? trauma : spine }),
    });
  }

  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    as: string | null,
    payload?: unknown,
  ): Promise<Res> {
    const res = await t.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: as ? { cookie: who[as]!.cookie } : {},
      ...(payload !== undefined && { payload: payload as object }),
    });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  }

  async function ok(res: Promise<Res>): Promise<any> {
    const r = await res;
    if (r.status >= 300) throw new Error(`Unexpected ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  }

  const ids = (...keys: string[]) => keys.map((k) => who[k]!.user.id);
  const team = () => ids('designer', 'pme', 'ops', 'dard', 'qc');

  async function go(name: string, teamUserIds = team()): Promise<string> {
    const body = await ok(
      call('POST', '/projects', 'vp', { name, productLineId: spine, teamUserIds }),
    );
    return body.project.id;
  }

  const route = (id: string, as = 'vp') => ok(call('GET', `/projects/${id}/route`, as));
  const stepOf = async (id: string, key: string, as = 'vp') =>
    (await route(id, as)).steps.find((s: { key: string }) => s.key === key);

  const { upload, attach } = documentCalls(call, ok);

  /** Submits a step as its first doer, then signs it off as its signer (both Board members at 4 and 23). */
  async function finish(id: string, key: string) {
    await attach(id, key);
    const step = await stepOf(id, key);
    await ok(
      call('POST', `/projects/${id}/steps/${key}/submit`, COOKIE_OF_ROLE[step.doers[0].key]!),
    );
    if (!step.signer) return;
    for (const as of step.signer.key === 'board'
      ? ['md', 'ceo']
      : [COOKIE_OF_ROLE[step.signer.key]!]) {
      await ok(call('POST', `/projects/${id}/steps/${key}/approve`, as));
    }
  }

  const milestone = (id: string, key: string, as: string) =>
    ok(call('POST', `/projects/${id}/milestones`, as, { milestone: key }));
  const decide = (id: string, step: string, decision: string, value: string) =>
    ok(call('POST', `/projects/${id}/steps/${step}/decisions`, 'head', { decision, value }));

  /** Walks a project through the route as far as step `through`, starting at `from` (default: the first). */
  async function advance(
    id: string,
    through: string,
    options: { preclinical?: 'yes' | 'no'; from?: string } = {},
  ) {
    const start = options.from ? ORDER.indexOf(options.from) : 0;
    for (const key of ORDER.slice(start)) {
      if (key === '10') {
        await milestone(id, 'material_received_implant', 'ops');
        await milestone(id, 'material_received_instrument', 'ops');
        await milestone(id, 'test_licence_recorded', 'dard');
      }
      if (key === '12') {
        await decide(id, '12', 'prototypes_ok', 'yes');
        await decide(id, '12', 'preclinical_needed', options.preclinical ?? 'no');
      }
      await finish(id, key);
      if (key === through) return;
    }
  }

  return {
    who,
    spine,
    call,
    ok,
    ids,
    team,
    go,
    route,
    stepOf,
    finish,
    milestone,
    decide,
    advance,
    upload,
    attach,
  };
}

export type World = Awaited<ReturnType<typeof createWorld>>;
