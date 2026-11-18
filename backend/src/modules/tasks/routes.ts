import { getTask, listTasks as listTasksEndpoint, updateTask } from '@coal/shared';
import { change } from '../../core/db/change';
import { implement } from '../../core/http/endpoint';
import { AppError, notFound } from '../../core/http/errors';
import { assertCanAccess } from '../permissions';
import { findTask, listTasks, presentTask, setTaskStatus } from './service';

export const tasksRoutes = [
  implement(listTasksEndpoint, ({ deps, ctx, actor, query }) =>
    listTasks(deps.db, ctx.orgId, actor, query),
  ),

  implement(getTask, async ({ deps, ctx, actor, params }) => {
    const task = await findTask(deps.db, ctx.orgId, params.id);
    if (!task) throw notFound('task');
    assertCanAccess('tasks.readOne', actor, task);
    return presentTask(deps.db, ctx.orgId, task);
  }),

  implement(updateTask, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const task = await findTask(tx, ctx.orgId, params.id, { forUpdate: true });
      if (!task) throw notFound('task');
      assertCanAccess('tasks.update', actor, task);
      if (!['open', 'in_progress', 'waiting'].includes(task.status)) {
        throw new AppError(409, 'ALREADY_DONE', 'This task is already closed.');
      }
      const updated = await setTaskStatus(tx, task, body.status);
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
      }
      return presentTask(tx, ctx.orgId, updated);
    }),
  ),
];
