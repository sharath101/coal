import { dateOfInstant, getTask, listTasks as listTasksEndpoint, updateTask } from '@coal/shared';
import { change } from '../../core/db/change';
import { implement } from '../../core/http/endpoint';
import { AppError, notFound } from '../../core/http/errors';
import { taskHasDeviation } from '../deviations/store';
import { assertCanAccess } from '../permissions';
import { recompute } from '../schedule/service';
import { findTask, listTasks, presentTask, setTaskStatus } from './service';

export const tasksRoutes = [
  implement(listTasksEndpoint, ({ deps, ctx, actor, query }) =>
    listTasks(deps.db, ctx.orgId, actor, query, deps.now()),
  ),

  implement(getTask, async ({ deps, ctx, actor, params }) => {
    const task = await findTask(deps.db, ctx.orgId, params.id);
    if (!task) throw notFound('task');
    assertCanAccess('tasks.readOne', actor, task);
    return presentTask(deps.db, ctx.orgId, task, deps.now());
  }),

  implement(updateTask, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const task = await findTask(tx, ctx.orgId, params.id, { forUpdate: true });
      if (!task) throw notFound('task');
      assertCanAccess('tasks.update', actor, task);
      if (!['open', 'in_progress', 'waiting'].includes(task.status)) {
        throw new AppError(409, 'ALREADY_DONE', 'This task is already closed.');
      }
      // A late task can't be closed until someone has said why (docs/dashboard.md#deviations).
      if (
        body.status === 'done' &&
        task.dueOn &&
        dateOfInstant(deps.now()) > task.dueOn &&
        !(await taskHasDeviation(tx, task.id, task.dueOn))
      ) {
        throw new AppError(
          409,
          'DEVIATION_REQUIRED',
          `This task was due on ${task.dueOn}. Record why it is late, and the new date, before closing it.`,
        );
      }
      const updated = await setTaskStatus(tx, task, body.status, deps.now());
      log.audit({
        action: 'task.updated',
        recordType: 'task',
        recordId: task.id,
        before: { status: task.status },
        after: { status: updated.status },
      });
      if (body.status === 'done') {
        log.event({
          type: 'task.done',
          projectId: task.subjectId,
          stepKey: task.stepKey,
          payload: { taskId: task.id },
        });
        // Finished work no longer holds the step's forecast back.
        if (task.runId && task.subjectId) {
          await recompute(tx, log, deps.now(), ctx.orgId, task.subjectId, task.runId);
        }
      }
      return presentTask(tx, ctx.orgId, updated, deps.now());
    }),
  ),
];
