import { search, type SearchHit } from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import { searchDocuments } from '../documents/service';
import { listRoles } from '../org/service';
import { searchProjects } from '../rnd/projects';
import { listProductLines } from '../rnd/service';
import { searchTasks } from '../tasks/service';
import { searchUsers } from '../users/service';

const STEP_WORD = (key: string | null) => (key ? ` · step ${key}` : '');
const excerpt = (text: string) => (text.length > 160 ? `${text.slice(0, 157)}…` : text) || null;

/**
 * One search across projects, documents, tasks and people (docs/api.md#dashboard-and-notifications).
 * Each kind is filtered by its own rule, so nothing comes back that the person couldn't open.
 */
export const searchRoutes = [
  implement(search, async ({ deps, ctx, actor, query }) => {
    const types = new Set(query.types?.split(',') ?? ['project', 'document', 'task', 'person']);
    const { q, limit } = query;
    const [projects, documents, tasks, people, lines, roles] = await Promise.all([
      types.has('project') ? searchProjects(deps.db, ctx.orgId, q, limit) : [],
      types.has('document') ? searchDocuments(deps.db, ctx, actor, q, limit) : [],
      types.has('task') ? searchTasks(deps.db, ctx.orgId, actor, q, limit) : [],
      types.has('person') ? searchUsers(deps.db, ctx.orgId, q, limit) : [],
      listProductLines(deps.db, ctx.orgId),
      listRoles(deps.db, ctx.orgId),
    ]);
    const lineName = new Map(lines.map((l) => [l.id, l.name]));
    const roleName = new Map(roles.map((r) => [r.key, r.name]));
    const items: SearchHit[] = [
      ...projects.map((p) => ({
        type: 'project' as const,
        id: p.id,
        title: `${p.code} · ${p.name}`,
        subtitle: `Project · ${lineName.get(p.productLineId) ?? ''}`,
        snippet: excerpt(p.description),
        projectId: p.id,
      })),
      ...documents.map((d) => ({
        type: 'document' as const,
        id: d.documentId,
        title: `${d.number} · ${d.title}`,
        subtitle: `${d.projectCode}${STEP_WORD(d.stepKey)} · version ${d.versionNo} (${d.status.replace('_', ' ')})`,
        snippet: d.snippet || null,
        projectId: d.projectId,
      })),
      ...tasks.map((t) => ({
        type: 'task' as const,
        id: t.id,
        title: t.title,
        subtitle: `Task · ${t.status.replace('_', ' ')}${t.subjectLabel ? ` · ${t.subjectLabel}` : ''}${STEP_WORD(t.stepKey)}`,
        snippet: excerpt(t.body),
        projectId: t.subjectType === 'project' ? t.subjectId : null,
      })),
      ...people.map((u) => ({
        type: 'person' as const,
        id: u.id,
        title: u.name,
        subtitle: [
          roleName.get(u.roleKey) ?? u.roleKey,
          u.productLineId && lineName.get(u.productLineId),
        ]
          .filter(Boolean)
          .join(' · '),
        snippet: null,
        projectId: null,
      })),
    ];
    return { items };
  }),
];
