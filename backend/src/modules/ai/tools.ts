import {
  SEARCH_TYPES,
  WIDGET_KEYS,
  compareVersions,
  createProposal,
  createTask,
  getActiveTemplate,
  getDocument,
  getProject,
  getProjectRoute,
  getTimeline,
  getWidget,
  listDeviations,
  listProjectDocuments,
  listProjects,
  listSignatureRequests,
  listTasks,
  listUsers,
  search,
  updateProposal,
  type EndpointOutput,
  type EndpointSpec,
} from '@coal/shared';
import { z } from 'zod';
import type { EndpointCall } from '../../core/http/call';
import { proposableImplementations } from '../../core/http/endpoint';

/** A record a tool returned, which an answer can cite (`Citation` in shared/). */
export interface ToolSource {
  type: string;
  id: string;
  label: string;
  link: string;
  passage?: string | null;
  version?: number;
}

export interface ToolShape {
  /** What the model sees, trimmed to what it needs. */
  data: unknown;
  sources: ToolSource[];
  /** Set by the tool that prepares an action card. */
  proposalId?: string;
}

/**
 * One tool the AI may use. Each is a thin wrapper over an endpoint of the backend and takes that
 * endpoint's AI tier: the endpoint's own checks decide what it may do, as the person asking
 * (docs/workstation-and-ai.md#what-the-ai-may-do). A test fails if one maps to a closed tier.
 */
export interface AiToolDef {
  name: string;
  endpoint: EndpointSpec;
  description: string;
  input: z.ZodObject;
  call(input: never): EndpointCall;
  /** What the activity line says, in plain words. */
  label(input: never): string;
  shape(output: never, input: never): ToolShape;
}

function aiTool<E extends EndpointSpec, I extends z.ZodObject>(def: {
  name: string;
  endpoint: E;
  description: string;
  input: I;
  call: (input: z.infer<I>) => EndpointCall;
  label: (input: z.infer<I>) => string;
  shape: (output: EndpointOutput<E>, input: z.infer<I>) => ToolShape;
}): AiToolDef {
  return def;
}

const id = (what: string) => z.uuid().describe(`The id of the ${what}`);
const names = (people: { name: string }[]) => people.map((p) => p.name).join(', ');

const project = (p: { id: string; code: string; name: string }): ToolSource => ({
  type: 'project',
  id: p.id,
  label: `${p.code} · ${p.name}`,
  link: `/projects/${p.id}`,
});

const ProposedActions = z
  .array(
    z.object({
      endpoint: z.string().describe('An endpoint id from the list'),
      params: z.record(z.string(), z.unknown()).optional(),
      query: z.record(z.string(), z.unknown()).optional(),
      body: z.unknown().optional(),
    }),
  )
  .min(1)
  .max(10);

const TOOLS: AiToolDef[] = [
  aiTool({
    name: 'search',
    endpoint: search,
    description:
      'Find projects, documents, tasks and people by words, codes or names. Use it first when you do not have an id. Only what the person may see is found.',
    input: z.object({
      q: z.string().min(2).max(200).describe('Words, a code such as SPN-26-001, or a name'),
      types: z.array(z.enum(SEARCH_TYPES)).optional().describe('Limit to some kinds'),
    }),
    call: ({ q, types }) => ({ query: { q, ...(types && { types: types.join(',') }), limit: 8 } }),
    label: ({ q }) => `Searched for “${q}”`,
    shape: (out) => ({
      data: out.items.map((h) => ({
        type: h.type,
        id: h.id,
        title: h.title,
        about: h.subtitle,
        projectId: h.projectId,
        snippet: h.snippet,
      })),
      sources: out.items.flatMap((h): ToolSource[] =>
        h.type === 'project'
          ? [{ type: 'project', id: h.id, label: h.title, link: `/projects/${h.id}` }]
          : h.type === 'document' && h.projectId
            ? [
                {
                  type: 'document',
                  id: h.id,
                  label: h.title,
                  link: `/projects/${h.projectId}/documents/${h.id}`,
                  passage: h.snippet,
                },
              ]
            : h.type === 'task'
              ? [{ type: 'task', id: h.id, label: h.title, link: '/tasks' }]
              : [],
      ),
    }),
  }),

  aiTool({
    name: 'my_tasks',
    endpoint: listTasks,
    description:
      "The person's tasks: assigned to them (mine), waiting in their role's queue (queue), or work and requests they gave others (sent). Open ones unless `closed` is set. Each has a due date and how many working days late it is.",
    input: z.object({
      scope: z.enum(['mine', 'queue', 'sent']).default('mine'),
      closed: z.boolean().default(false).describe('Show finished, declined and cancelled ones'),
    }),
    call: ({ scope, closed }) => ({
      query: { scope, 'filter[status]': closed ? 'closed' : 'active', limit: 25 },
    }),
    label: ({ scope }) =>
      scope === 'queue'
        ? 'Looked at your role’s queue'
        : scope === 'sent'
          ? 'Looked at what you gave others'
          : 'Looked at your tasks',
    shape: (out) => ({
      data: out.items.map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        status: t.status,
        project: t.subject?.label ?? null,
        step: t.stepKey,
        dueOn: t.dueOn,
        daysLate: t.daysLate,
        assignee: t.assignee?.name ?? null,
        givenBy: t.assignedBy?.name ?? null,
        request: t.request,
      })),
      sources: out.items.map((t) => ({
        type: 'task',
        id: t.id,
        label: t.title,
        link: '/tasks',
      })),
    }),
  }),

  aiTool({
    name: 'list_projects',
    endpoint: listProjects,
    description:
      'List projects with their stage, health and planned and forecast launch. Status of every project is open to everyone.',
    input: z.object({
      status: z.enum(['active', 'on_hold', 'dropped', 'completed', 'closed']).optional(),
    }),
    call: ({ status }) => ({ query: { limit: 25, ...(status && { 'filter[status]': status }) } }),
    label: () => 'Looked at the projects',
    shape: (out) => ({
      data: out.items.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        line: p.productLine.name,
        status: p.status,
        stage: p.stage,
        health: p.health,
        healthReasons: p.healthReasons,
        plannedLaunch: p.plannedLaunch,
        forecastLaunch: p.forecastLaunch,
      })),
      sources: out.items.map(project),
    }),
  }),

  aiTool({
    name: 'get_project',
    endpoint: getProject,
    description: 'One project: its stage, health, launch dates, hold or drop reason and team.',
    input: z.object({ projectId: id('project') }),
    call: ({ projectId }) => ({ params: { id: projectId } }),
    label: () => 'Opened a project',
    shape: (p) => ({
      data: {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        line: p.productLine.name,
        status: p.status,
        stage: p.stage,
        health: p.health,
        healthReasons: p.healthReasons,
        plannedLaunch: p.plannedLaunch,
        forecastLaunch: p.forecastLaunch,
        holdReason: p.holdReason,
        dropReason: p.dropReason,
        team: p.team.map((m) => `${m.user.name} (${m.user.role.name})`),
      },
      sources: [project(p)],
    }),
  }),

  aiTool({
    name: 'get_route',
    endpoint: getProjectRoute,
    description:
      "A project's steps: each one's state, who does it, who signs it, what it waits for and its dates. Use it to say where a project is and what comes next.",
    input: z.object({ projectId: id('project') }),
    call: ({ projectId }) => ({ params: { id: projectId } }),
    label: () => 'Looked at a project’s route',
    shape: (r, { projectId }) => ({
      data: {
        status: r.status,
        stage: r.stage,
        openCorrectiveActions: r.openCorrectiveActions,
        steps: r.steps.map((s) => ({
          step: s.key,
          name: s.name,
          stage: s.stage,
          status: s.status,
          iteration: s.iteration,
          doers: names(s.doers),
          signer: s.signer?.name ?? null,
          plannedEnd: s.plannedEnd,
          forecastEnd: s.forecastEnd,
          health: s.health,
          daysLate: s.daysLate,
        })),
        milestones: r.milestones.map((m) => ({ name: m.name, reached: m.reached })),
      },
      sources: [
        {
          type: 'project',
          id: projectId,
          label: 'Route of the project',
          link: `/projects/${projectId}`,
        },
      ],
    }),
  }),

  aiTool({
    name: 'get_timeline',
    endpoint: getTimeline,
    description:
      "A project's dates: planned and forecast start and end of every step, how late each is, and the launch slip. Use it for questions about dates and delays.",
    input: z.object({ projectId: id('project') }),
    call: ({ projectId }) => ({ params: { id: projectId } }),
    label: () => 'Looked at a project’s dates',
    shape: (t, { projectId }) => ({
      data: {
        today: t.today,
        plannedLaunch: t.plannedLaunch,
        forecastLaunch: t.forecastLaunch,
        slipDays: t.slipDays,
        health: t.health,
        healthReasons: t.healthReasons,
        steps: t.steps.map((s) => ({
          step: s.key,
          name: s.name,
          status: s.status,
          plannedStart: s.plannedStart,
          plannedEnd: s.plannedEnd,
          forecastEnd: s.forecastEnd,
          health: s.health,
          daysLate: s.daysLate,
          needsDeviation: s.needsDeviation,
        })),
      },
      sources: [
        {
          type: 'timeline',
          id: projectId,
          label: 'Dates of the project',
          link: `/projects/${projectId}`,
        },
      ],
    }),
  }),

  aiTool({
    name: 'list_deviations',
    endpoint: listDeviations,
    description:
      'Records that explain why work is late: the reason, the new date and who confirmed it. The named cause is shown only if the person may see it.',
    input: z.object({
      projectId: id('project').optional(),
      needsReview: z.boolean().default(false).describe('Only those waiting to be confirmed'),
    }),
    call: ({ projectId, needsReview }) => ({
      query: {
        limit: 15,
        ...(projectId && { 'filter[project]': projectId }),
        'filter[state]': needsReview ? 'review' : 'all',
      },
    }),
    label: () => 'Looked at delays and their reasons',
    shape: (out) => ({
      data: out.items.map((d) => ({
        id: d.id,
        project: d.project.code,
        step: d.stepKey,
        task: d.taskTitle,
        kind: d.kind,
        plannedDate: d.plannedDate,
        newDate: d.newDate,
        reason: d.reasonCode,
        explanation: d.reasonText,
        cause: d.cause.named ? d.cause.name : (d.cause.role?.name ?? d.cause.type),
        recordedBy: d.recordedBy.name,
        review: d.review?.outcome ?? 'waiting',
      })),
      sources: out.items.map((d) => ({
        type: 'deviation',
        id: d.id,
        label: `Delay on ${d.project.code}${d.stepKey ? `, step ${d.stepKey}` : ''}`,
        link: `/projects/${d.project.id}${d.stepKey ? `?step=${d.stepKey}` : ''}`,
      })),
    }),
  }),

  aiTool({
    name: 'list_documents',
    endpoint: listProjectDocuments,
    description:
      'The documents of a project that the person may see, optionally of one step: number, title, status and latest version. A restricted one shows only that it exists.',
    input: z.object({
      projectId: id('project'),
      stepKey: z.string().max(8).optional().describe('Only the documents of this step'),
    }),
    call: ({ projectId, stepKey }) => ({
      params: { id: projectId },
      query: stepKey ? { step: stepKey } : {},
    }),
    label: () => 'Looked at the project’s documents',
    shape: (out) => ({
      data: out.items.map((d) => ({
        id: d.id,
        number: d.number,
        title: d.title,
        type: d.type.name,
        step: d.stepKey,
        status: d.status,
        latestVersion: d.latestVersionNo,
        approvedRev: d.approvedRev,
        restricted: d.restricted,
      })),
      sources: out.items
        .filter((d) => !d.restricted)
        .map((d) => ({
          type: 'document',
          id: d.id,
          label: `${d.number} · ${d.title}`,
          link: `/projects/${d.projectId}/documents/${d.id}`,
        })),
    }),
  }),

  aiTool({
    name: 'read_document',
    endpoint: getDocument,
    description:
      'Read a document: its fields and written sections, its versions, who signs and who has signed. Latest version unless `version` is given.',
    input: z.object({ documentId: id('document'), version: z.number().int().min(1).optional() }),
    call: ({ documentId, version }) => ({
      params: { id: documentId },
      query: version ? { version } : {},
    }),
    label: () => 'Read a document',
    shape: (d) => ({
      data: {
        id: d.id,
        number: d.number,
        title: d.title,
        type: d.type.name,
        step: d.stepKey,
        status: d.status,
        restricted: d.restricted,
        template: d.template ? `${d.template.name} v${d.template.version}` : null,
        signatureRows: d.signatureRows.map((r) => `${r.meaning}: ${names(r.roles)}`),
        versions: d.versions.map((v) => ({
          version: v.versionNo,
          rev: v.revLabel,
          status: v.status,
          by: v.createdBy.name,
          note: v.note,
        })),
        current: d.current && {
          version: d.current.versionNo,
          status: d.current.status,
          fields: d.current.content?.fields ?? null,
          sections: d.current.content?.sections ?? null,
          uploadedFile: d.current.file?.name ?? null,
          signatures: d.current.signatures.map((s) => `${s.meaning}: ${s.by.name}`),
          waitingOn: d.current.requests
            .filter((r) => r.status === 'pending' || r.status === 'waiting')
            .map((r) => `${r.meaning}: ${r.assignee?.name ?? r.role.name}`),
        },
      },
      sources: d.restricted
        ? []
        : [
            {
              type: 'document',
              id: d.id,
              label: `${d.number} · ${d.title}`,
              link: `/projects/${d.projectId}/documents/${d.id}`,
              ...(d.current && { version: d.current.versionNo }),
            },
          ],
    }),
  }),

  aiTool({
    name: 'compare_versions',
    endpoint: compareVersions,
    description: 'What changed between two versions of a document, section by section.',
    input: z.object({
      documentId: id('document'),
      from: z.number().int().min(1).describe('The older version number'),
      to: z.number().int().min(1).describe('The newer version number'),
    }),
    call: ({ documentId, from, to }) => ({ params: { id: documentId }, query: { from, to } }),
    label: ({ from, to }: { from: number; to: number }) => `Compared versions ${from} and ${to}`,
    shape: (out, { documentId }) => ({
      data: out,
      sources: [{ type: 'document', id: documentId, label: 'Document comparison', link: '' }],
    }),
  }),

  aiTool({
    name: 'active_template',
    endpoint: getActiveTemplate,
    description:
      'The template in use for a kind of document, with which sections are fields and which are written. Always ask for it, never rely on memory: it may have changed.',
    input: z.object({
      documentType: z.string().min(1).max(24).describe('The document type code, such as PID'),
    }),
    call: ({ documentType }) => ({ query: { documentType } }),
    label: ({ documentType }: { documentType: string }) => `Looked up the ${documentType} template`,
    shape: (t) => ({
      data: { id: t.id, name: t.name, version: t.version, status: t.status, spec: t.spec },
      sources: [
        { type: 'template', id: t.id, label: `${t.name} v${t.version}`, link: '/templates' },
      ],
    }),
  }),

  aiTool({
    name: 'find_person',
    endpoint: listUsers,
    description: 'Look up people by name or role: their id, role and product line.',
    input: z.object({
      q: z.string().max(80).optional().describe('Part of a name'),
      role: z.string().max(40).optional().describe('A role key, such as pme or dard'),
    }),
    call: ({ q, role }) => ({
      query: { limit: 15, ...(q && { q }), ...(role && { 'filter[role]': role }) },
    }),
    label: ({ q }: { q?: string }) =>
      q ? `Looked up “${q}” among the people` : 'Looked at the people',
    shape: (out) => ({
      data: out.items.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role.name,
        roleKey: u.role.key,
        productLine: u.productLine?.name ?? null,
      })),
      sources: out.items.map((u) => ({ type: 'person', id: u.id, label: u.name, link: '' })),
    }),
  }),

  aiTool({
    name: 'waiting_signatures',
    endpoint: listSignatureRequests,
    description:
      'The documents waiting for the person’s signature, with how long they have waited.',
    input: z.object({}),
    call: () => ({}),
    label: () => 'Looked at what waits for your signature',
    shape: (out) => ({
      data: out.items.map((s) => ({
        document: `${s.number} · ${s.title}`,
        version: s.versionNo,
        meaning: s.meaning,
        project: s.project.code,
        step: s.stepKey,
        since: s.requestedAt,
      })),
      sources: out.items.map((s) => ({
        type: 'document',
        id: s.documentId,
        label: `${s.number} · ${s.title}`,
        link: `/projects/${s.project.id}/documents/${s.documentId}`,
        version: s.versionNo,
      })),
    }),
  }),

  aiTool({
    name: 'get_widget',
    endpoint: getWidget,
    description: `One Dashboard widget's numbers and rows, as the person sees it. Keys: ${WIDGET_KEYS.join(', ')}.`,
    input: z.object({
      key: z.enum(WIDGET_KEYS),
      tab: z.string().max(40).optional(),
      expanded: z.boolean().default(false),
    }),
    call: ({ key, tab, expanded }) => ({
      params: { key },
      query: { view: expanded ? 'expanded' : 'compact', ...(tab && { tab }) },
    }),
    label: ({ key }: { key: string }) => `Looked at the ${key} widget`,
    shape: (w) => ({
      data: {
        counts: w.counts,
        tabs: w.tabs,
        total: w.total,
        rows: w.rows.map((r) => ({
          title: r.title,
          subtitle: r.subtitle,
          badges: r.badges.map((b) => b.label),
          cells: r.cells,
        })),
      },
      sources: [{ type: 'widget', id: w.key, label: `Dashboard: ${w.key}`, link: '/dashboard' }],
    }),
  }),

  aiTool({
    name: 'create_my_task',
    endpoint: createTask,
    description:
      "Add a task to the person's OWN list, such as a reminder. It never goes to anyone else: for work or a request to someone else, use `propose`.",
    input: z.object({
      title: z.string().min(3).max(200),
      body: z.string().max(2000).optional(),
      dueOn: z.iso.date().optional().describe('YYYY-MM-DD, not in the past'),
      projectId: id('project').optional(),
      stepKey: z.string().max(8).optional(),
    }),
    call: (input) => ({ body: input }),
    label: () => 'Added a task to your list',
    shape: (out) => ({
      data: { id: out.task.id, title: out.task.title, dueOn: out.task.dueOn, kind: out.task.kind },
      sources: [{ type: 'task', id: out.task.id, label: out.task.title, link: '/tasks' }],
    }),
  }),

  aiTool({
    name: 'propose',
    endpoint: createProposal,
    // The catalogue of actions is added when the tools are built, from the endpoints that allow it.
    description: 'Prepare actions for the person to confirm on an action card.',
    input: z.object({
      title: z.string().min(3).max(200).describe('What the card does, in a few words'),
      actions: ProposedActions,
    }),
    call: (input) => ({ body: input }),
    label: () => 'Prepared an action card',
    shape: (p) => ({
      data: {
        proposalId: p.id,
        status: p.status,
        shownToThePerson: p.preview.actions.map((a) => ({
          summary: a.summary,
          warnings: a.effects.warnings,
          told: names(a.notified),
        })),
        note: 'The card is shown to the person. Nothing has happened yet: they confirm it.',
      },
      sources: [],
      proposalId: p.id,
    }),
  }),

  aiTool({
    name: 'revise_card',
    endpoint: updateProposal,
    description:
      'Change an action card that is still waiting for the person (the people, dates or wording). Send the COMPLETE new list of actions, not only the change. Use the card id given in the instructions. The person then checks the changed card.',
    input: z.object({
      proposalId: id('action card'),
      title: z.string().min(3).max(200).optional(),
      actions: ProposedActions,
    }),
    call: ({ proposalId, ...body }) => ({ params: { id: proposalId }, body }),
    label: () => 'Changed an action card',
    shape: (p) => ({
      data: {
        proposalId: p.id,
        version: p.version,
        shownToThePerson: p.preview.actions.map((a) => ({
          summary: a.summary,
          warnings: a.effects.warnings,
          told: names(a.notified),
        })),
        note: 'The changed card is shown to the person. Nothing has happened yet: they confirm it.',
      },
      sources: [],
      proposalId: p.id,
    }),
  }),
];

/** A short description of an endpoint's input, for the list of actions `propose` offers. */
function signatureOf(schema: z.ZodType | undefined): string {
  if (!schema) return '';
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, { type?: string; format?: string; enum?: string[] }>;
    required?: string[];
  };
  const parts = Object.entries(json.properties ?? {}).map(([key, p]) => {
    const type = p.enum ? p.enum.join('|') : `${p.type ?? 'any'}${p.format ? `(${p.format})` : ''}`;
    return `${key}${json.required?.includes(key) ? '' : '?'}: ${type}`;
  });
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : '';
}

/** The actions `propose` may carry: the endpoints that can go on an action card, with their inputs. */
export function proposableCatalogue(): string {
  return proposableImplementations()
    .map(({ endpoint: e }) => {
      const shapes = [
        ['params', signatureOf(e.params)],
        ['query', signatureOf(e.query)],
        ['body', signatureOf(e.body)],
      ]
        .filter(([, s]) => s)
        .map(([k, s]) => `${k} ${s}`)
        .join('; ');
      return `- ${e.id}: ${e.summary}${shapes ? ` (${shapes})` : ''}`;
    })
    .join('\n');
}

/** The tools, with the action catalogue written into `propose`. */
export function aiToolDefs(): AiToolDef[] {
  return TOOLS.map((t) =>
    t.name === 'propose'
      ? {
          ...t,
          description: `Prepare one or more actions for the person to confirm on an action card. Use it for anything that affects other people or that you may not do yourself: assigning work or asking someone (tasks.create with assigneeId), starting or submitting a step, recording a delay's reason, answering a request. Put all the actions of one request in ONE call, so they are one card. Nothing happens until the person confirms; never say it is done. Each action is { endpoint, params, query, body }. Whether it becomes an assignment or a request is decided by the server from the reporting line, so do not promise one. The actions:\n${proposableCatalogue()}`,
        }
      : t,
  );
}

/** The JSON Schema a provider shows the model for a tool's input. */
export function inputSchemaOf(def: AiToolDef): Record<string, unknown> {
  const { $schema: _schema, ...schema } = z.toJSONSchema(def.input, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return schema;
}
