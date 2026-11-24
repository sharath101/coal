import type { Deviation, RecordDeviationBody } from '@coal/shared';
import { dateOfInstant } from '@coal/shared';
import type { z } from 'zod';
import { change } from '../../core/db/change';
import type { Executor } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { listRoles } from '../org/service';
import { ROLES } from '../org/catalogue';
import { assertCanAccess, canAccess } from '../permissions';
import { NO_ONE, causeNameVisible, inScope } from '../permissions/rules';
import { loadEnv } from '../rnd/env';
import {
  findProject,
  memberIdsOf,
  projectsByRuns,
  requireActiveUsers,
  type ProjectRow,
} from '../rnd/projects';
import { recompute } from '../schedule/service';
import { findTask, setTaskDueDate, tasksByIds } from '../tasks/service';
import { findUsersByIds, personOf } from '../users/service';
import {
  commentsOf,
  correctionsOf,
  findDeviation,
  insertComment,
  insertDeviation,
  insertReview,
  listDeviationRows,
  reviewsOf,
  type DeviationRow,
} from './store';

type Recorded = z.output<typeof RecordDeviationBody>;

/** The shape of a cause as the person recording or correcting gives it. */
interface CauseInput {
  causeType: 'person' | 'role' | 'outside';
  causeUserId?: string | undefined;
  causeRole?: string | undefined;
  causeParty?: string | undefined;
}

async function checkCause(tx: Executor, orgId: string, cause: CauseInput) {
  if (cause.causeType === 'person') {
    await requireActiveUsers(tx, orgId, [cause.causeUserId as string], 'causeUserId');
  }
  if (cause.causeType === 'role' && !ROLES.some((r) => r.key === cause.causeRole)) {
    throw validationFailed('There is no such role.', 'causeRole');
  }
}

const causeColumns = (cause: CauseInput) => ({
  causeType: cause.causeType,
  causeUserId: cause.causeType === 'person' ? (cause.causeUserId ?? null) : null,
  causeRole: cause.causeType === 'role' ? (cause.causeRole ?? null) : null,
  causeParty: cause.causeType === 'outside' ? (cause.causeParty ?? null) : null,
});

/** Shows deviations to one person: the explanation to those in the project's scope, the named cause to those allowed. */
export async function presentDeviations(
  ex: Executor,
  orgId: string,
  actor: Actor,
  rows: DeviationRow[],
): Promise<Deviation[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [runs, reviews, comments, corrections, roles, tasks] = await Promise.all([
    projectsByRuns(
      ex,
      orgId,
      rows.map((r) => r.runId),
    ),
    reviewsOf(ex, ids),
    commentsOf(ex, ids),
    correctionsOf(ex, ids),
    listRoles(ex, orgId),
    tasksByIds(
      ex,
      rows.flatMap((r) => (r.taskId ? [r.taskId] : [])),
    ),
  ]);
  const members = await memberIdsOf(
    ex,
    [...runs.values()].map((p) => p.id),
  );
  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(r.recordedBy);
    if (r.causeUserId) userIds.add(r.causeUserId);
  }
  for (const review of reviews.values()) userIds.add(review.reviewerId);
  for (const list of comments.values()) list.forEach((c) => userIds.add(c.userId));
  const people = new Map((await findUsersByIds(ex, orgId, [...userIds])).map((u) => [u.id, u]));
  const roleName = new Map(roles.map((r) => [r.key, r.name]));
  const roleRef = (key: string) => ({ key, name: roleName.get(key) ?? key });
  const person = (id: string) => ({ id, name: people.get(id)?.name ?? 'Unknown' });

  return rows.map((row) => {
    const project = runs.get(row.runId) as ProjectRow;
    const scope = {
      productLineId: project.productLineId,
      memberIds: members.get(project.id) ?? [],
    };
    const inside = inScope(actor, scope);
    const causeUser = row.causeUserId ? people.get(row.causeUserId) : undefined;
    const review = reviews.get(row.id);
    const recorder = people.get(row.recordedBy);

    let cause: Deviation['cause'];
    if (row.causeType === 'person') {
      const visible =
        row.recordedBy === actor.userId ||
        causeNameVisible(actor, {
          userId: row.causeUserId,
          user: causeUser ? personOf(causeUser) : null,
          ...scope,
        });
      cause = {
        type: 'person',
        role: causeUser ? roleRef(causeUser.roleKey) : null,
        name: visible ? (causeUser?.name ?? null) : null,
        named: visible,
      };
    } else if (row.causeType === 'role') {
      cause = {
        type: 'role',
        role: row.causeRole ? roleRef(row.causeRole) : null,
        name: null,
        named: true,
      };
    } else {
      cause = { type: 'outside', role: null, name: inside ? row.causeParty : null, named: inside };
    }

    return {
      id: row.id,
      project: { id: project.id, code: project.code, name: project.name },
      stepKey: row.stepKey,
      taskId: row.taskId,
      // A task's title is content when it is a corrective action's: shown to the project's scope only.
      taskTitle: row.taskId && inside ? (tasks.get(row.taskId)?.title ?? null) : null,
      kind: row.kind,
      plannedDate: row.plannedDate,
      newDate: row.newDate,
      reasonCode: row.reasonCode,
      reasonText: inside ? row.reasonText : null,
      cause,
      recordedBy: person(row.recordedBy),
      createdAt: row.createdAt.toISOString(),
      review: review
        ? {
            outcome: review.outcome,
            reviewer: person(review.reviewerId),
            note: inside ? review.note : '',
            at: review.createdAt.toISOString(),
            correctedBy: review.correctedById,
          }
        : null,
      corrects: row.correctsId,
      correctedBy: corrections.get(row.id) ?? null,
      comments: inside
        ? (comments.get(row.id) ?? []).map((c) => ({
            id: c.id,
            user: person(c.userId),
            body: c.body,
            at: c.createdAt.toISOString(),
          }))
        : [],
      can: {
        review:
          !review &&
          !row.correctsId &&
          row.kind !== 'rework' &&
          canAccess('deviations.review', actor, {
            ...scope,
            recorder: recorder ? personOf(recorder) : NO_ONE,
            recordedById: row.recordedBy,
          }).allowed,
        comment: canAccess('deviations.comment', actor, {
          ...scope,
          causeUserId: row.causeUserId,
          causeRole: row.causeRole,
        }).allowed,
      },
    };
  });
}

export async function listDeviations(
  ex: Executor,
  orgId: string,
  actor: Actor,
  query: {
    cursor?: string | undefined;
    limit: number;
    'filter[project]'?: string | undefined;
    'filter[state]': 'all' | 'review';
  },
) {
  let runIds: string[] | undefined;
  if (query['filter[project]']) {
    const project = await findProject(ex, orgId, query['filter[project]']);
    runIds = project ? [project.processRunId] : [];
  }
  const { rows, nextCursor } = await listDeviationRows(ex, orgId, {
    cursor: query.cursor,
    limit: query.limit,
    runIds,
    state: query['filter[state]'],
  });
  return { items: await presentDeviations(ex, orgId, actor, rows), nextCursor };
}

async function presentOne(ex: Executor, orgId: string, actor: Actor, row: DeviationRow) {
  const [item] = await presentDeviations(ex, orgId, actor, [row]);
  return item as Deviation;
}

export async function recordDeviation(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  body: Recorded,
): Promise<Deviation> {
  return change(deps.db, ctx, async (tx, log) => {
    // The run is locked before the task, as every action does, so two of them can't wait on each other.
    const peek = await findTask(tx, ctx.orgId, body.taskId);
    if (!peek?.runId || !peek.runStepId || !peek.subjectId) throw notFound('task');
    const env = await loadEnv(tx, ctx.orgId, actor, peek.subjectId, { forUpdate: true });
    const task = await findTask(tx, ctx.orgId, body.taskId, { forUpdate: true });
    if (!task?.runId || !task.runStepId) throw notFound('task');
    assertCanAccess('deviations.record', actor, {
      assigneeId: task.assigneeId,
      productLineId: env.project.productLineId,
      memberIds: env.team.map((u) => u.id),
    });
    if (!['open', 'in_progress', 'waiting'].includes(task.status)) {
      throw new AppError(409, 'ALREADY_DONE', 'This task is already closed.');
    }
    if (!['active', 'on_hold'].includes(env.loaded.state.status)) {
      throw new AppError(409, 'PROJECT_NOT_ACTIVE', "The project isn't running.");
    }
    const today = dateOfInstant(deps.now());
    if (body.newDate < today) {
      throw validationFailed('The new date can not be in the past.', 'newDate');
    }
    await checkCause(tx, ctx.orgId, body);

    const late = !!task.dueOn && today > task.dueOn;
    const row = await insertDeviation(tx, ctx.orgId, {
      runId: task.runId,
      runStepId: task.runStepId,
      stepKey: task.stepKey,
      taskId: task.id,
      kind: late ? 'late' : 'forecast_slip',
      plannedDate: task.dueOn,
      newDate: body.newDate,
      reasonCode: body.reasonCode,
      reasonText: body.reasonText,
      ...causeColumns(body),
      recordedBy: actor.userId,
      correctsId: null,
    });
    await setTaskDueDate(tx, task.id, body.newDate);
    log.audit({
      action: 'deviation.recorded',
      recordType: 'deviation',
      recordId: row.id,
      after: {
        taskId: task.id,
        step: task.stepKey,
        kind: row.kind,
        newDate: row.newDate,
        reasonCode: row.reasonCode,
        causeType: row.causeType,
      },
    });
    log.event({
      type: 'deviation.recorded',
      projectId: env.project.id,
      stepKey: task.stepKey,
      payload: {
        deviationId: row.id,
        taskId: task.id,
        kind: row.kind,
        newDate: row.newDate,
        reasonCode: row.reasonCode,
      },
    });
    await recompute(tx, log, deps.now(), ctx.orgId, env.project.id, task.runId);
    return presentOne(tx, ctx.orgId, actor, row);
  });
}

type ReviewInput =
  | { outcome: 'confirmed'; note: string }
  | ({
      outcome: 'corrected';
      note: string;
      reasonCode: Recorded['reasonCode'];
      reasonText: string;
      newDate: string;
    } & CauseInput);

export async function reviewDeviation(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  body: ReviewInput,
): Promise<Deviation> {
  return change(deps.db, ctx, async (tx, log) => {
    const row = await findDeviation(tx, ctx.orgId, id);
    if (!row) throw notFound('deviation');
    const runs = await projectsByRuns(tx, ctx.orgId, [row.runId]);
    const project = runs.get(row.runId);
    if (!project) throw notFound('deviation');
    const env = await loadEnv(tx, ctx.orgId, actor, project.id, { forUpdate: true });
    const [recorder] = await findUsersByIds(tx, ctx.orgId, [row.recordedBy]);
    assertCanAccess('deviations.review', actor, {
      productLineId: env.project.productLineId,
      memberIds: env.team.map((u) => u.id),
      recorder: recorder ? personOf(recorder) : NO_ONE,
      recordedById: row.recordedBy,
    });
    if (row.kind === 'rework') {
      throw new AppError(
        409,
        'ALREADY_DONE',
        "A send-back's rework record has nothing to confirm.",
      );
    }
    if (row.correctsId || (await reviewsOf(tx, [row.id])).has(row.id)) {
      throw new AppError(409, 'ALREADY_DONE', 'This deviation has already been reviewed.');
    }

    let correctedById: string | null = null;
    if (body.outcome === 'corrected') {
      const today = dateOfInstant(deps.now());
      if (body.newDate < today) {
        throw validationFailed('The new date can not be in the past.', 'newDate');
      }
      await checkCause(tx, ctx.orgId, body);
      const corrected = await insertDeviation(tx, ctx.orgId, {
        runId: row.runId,
        runStepId: row.runStepId,
        stepKey: row.stepKey,
        taskId: row.taskId,
        kind: row.kind,
        plannedDate: row.plannedDate,
        newDate: body.newDate,
        reasonCode: body.reasonCode,
        reasonText: body.reasonText,
        ...causeColumns(body),
        recordedBy: actor.userId,
        correctsId: row.id,
      });
      correctedById = corrected.id;
      if (row.taskId) await setTaskDueDate(tx, row.taskId, body.newDate);
    }
    await insertReview(tx, ctx.orgId, {
      deviationId: row.id,
      reviewerId: actor.userId,
      outcome: body.outcome,
      correctedById,
      note: body.note,
    });
    log.audit({
      action: 'deviation.reviewed',
      recordType: 'deviation',
      recordId: row.id,
      after: { outcome: body.outcome, correctedBy: correctedById },
    });
    log.event({
      type: 'deviation.reviewed',
      projectId: env.project.id,
      stepKey: row.stepKey,
      payload: { deviationId: row.id, outcome: body.outcome },
    });
    if (correctedById) {
      await recompute(tx, log, deps.now(), ctx.orgId, env.project.id, row.runId);
    }
    return presentOne(tx, ctx.orgId, actor, row);
  });
}

export async function commentOnDeviation(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  text: string,
): Promise<Deviation> {
  return change(deps.db, ctx, async (tx, log) => {
    const row = await findDeviation(tx, ctx.orgId, id);
    if (!row) throw notFound('deviation');
    const project = (await projectsByRuns(tx, ctx.orgId, [row.runId])).get(row.runId);
    if (!project) throw notFound('deviation');
    const env = await loadEnv(tx, ctx.orgId, actor, project.id);
    assertCanAccess('deviations.comment', actor, {
      productLineId: env.project.productLineId,
      memberIds: env.team.map((u) => u.id),
      causeUserId: row.causeUserId,
      causeRole: row.causeRole,
    });
    const comment = await insertComment(tx, ctx.orgId, {
      deviationId: row.id,
      userId: actor.userId,
      body: text,
    });
    log.audit({
      action: 'deviation.commented',
      recordType: 'deviation',
      recordId: row.id,
      after: { commentId: comment.id },
    });
    return presentOne(tx, ctx.orgId, actor, row);
  });
}
