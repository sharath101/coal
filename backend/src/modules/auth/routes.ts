import { signIn, signOut, signUp, switchPerson } from '@coal/shared';
import { change } from '../../core/db/change';
import type { AppDeps } from '../../core/deps';
import { implement } from '../../core/http/endpoint';
import { AppError, notFound } from '../../core/http/errors';
import { createUser, findUser, findUserByName, presentMe, userSnapshot } from '../users/service';
import {
  clearSessionCookie,
  deviceOf,
  endSession,
  setSessionCookie,
  startSession,
} from './service';

const signInLimit = (deps: AppDeps) => ({
  max: deps.config.session.signInLimitPerMinute,
  timeWindow: '1 minute',
});

export const authRoutes = [
  implement(
    signUp,
    async ({ deps, ctx, body, http }) => {
      const { user, session } = await change(deps.db, ctx, async (tx, log) => {
        const user = await createUser(tx, ctx.orgId, body);
        const session = await startSession(tx, ctx.orgId, user.id, {
          days: deps.config.session.days,
          device: deviceOf(http.request),
        });
        const actor = { type: 'user' as const, id: user.id };
        log.audit({
          action: 'user.signed_up',
          recordType: 'user',
          recordId: user.id,
          after: userSnapshot(user),
          actor,
        });
        log.audit({
          action: 'session.started',
          recordType: 'session',
          recordId: session.id,
          actor,
        });
        return { user, session };
      });
      setSessionCookie(
        http.reply,
        session.token,
        session.expiresAt,
        deps.config.session.cookieSecure,
      );
      return { user: await presentMe(deps.db, ctx.orgId, user) };
    },
    { rateLimit: signInLimit },
  ),

  implement(
    signIn,
    async ({ deps, ctx, body, http }) => {
      const user = await findUserByName(deps.db, ctx.orgId, body.name);
      if (!user) {
        throw new AppError(
          404,
          'NOT_FOUND',
          'There is no account with that name. Check the spelling, or create one.',
        );
      }
      if (user.status !== 'active' || (user.roleKey === 'admin' && !deps.config.adminSwitching)) {
        throw new AppError(403, 'NOT_ALLOWED', 'This account is switched off.');
      }
      const session = await change(deps.db, ctx, async (tx, log) => {
        const session = await startSession(tx, ctx.orgId, user.id, {
          days: deps.config.session.days,
          device: deviceOf(http.request),
        });
        log.audit({
          action: 'session.started',
          recordType: 'session',
          recordId: session.id,
          actor: { type: 'user', id: user.id },
        });
        return session;
      });
      setSessionCookie(
        http.reply,
        session.token,
        session.expiresAt,
        deps.config.session.cookieSecure,
      );
      return { user: await presentMe(deps.db, ctx.orgId, user) };
    },
    { rateLimit: signInLimit },
  ),

  implement(switchPerson, async ({ deps, ctx, actor, body, http }) => {
    const adminId = actor.switcherId as string;
    const target = await findUser(deps.db, ctx.orgId, body.userId);
    if (!target) throw notFound('person');
    if (target.status !== 'active') {
      throw new AppError(403, 'NOT_ALLOWED', 'That account is switched off.');
    }
    if (target.id === actor.userId) {
      return { user: await presentMe(deps.db, ctx.orgId, target) };
    }
    const session = await change(deps.db, ctx, async (tx, log) => {
      if (ctx.sessionId) await endSession(tx, ctx.orgId, ctx.sessionId);
      const started = await startSession(tx, ctx.orgId, target.id, {
        days: deps.config.session.days,
        device: deviceOf(http.request),
        // Going back to the admin is an ordinary session: switching starts from the admin's own.
        switchedById: target.id === adminId ? null : adminId,
      });
      log.audit({
        action: 'session.switched',
        recordType: 'session',
        recordId: started.id,
        before: { userId: actor.userId },
        after: { userId: target.id },
        actor: { type: 'user', id: adminId },
      });
      return started;
    });
    setSessionCookie(
      http.reply,
      session.token,
      session.expiresAt,
      deps.config.session.cookieSecure,
    );
    return { user: await presentMe(deps.db, ctx.orgId, target) };
  }),

  implement(signOut, async ({ deps, ctx, http }) => {
    const sessionId = ctx.sessionId;
    if (sessionId) {
      await change(deps.db, ctx, async (tx, log) => {
        await endSession(tx, ctx.orgId, sessionId);
        log.audit({ action: 'session.ended', recordType: 'session', recordId: sessionId });
      });
    }
    clearSessionCookie(http.reply, deps.config.session.cookieSecure);
  }),
];
