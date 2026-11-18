import { signIn, signOut, signUp } from '@coal/shared';
import { change } from '../../core/db/change';
import type { AppDeps } from '../../core/deps';
import { implement } from '../../core/http/endpoint';
import { AppError } from '../../core/http/errors';
import { createUser, findUserByName, presentMe, userSnapshot } from '../users/service';
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
      if (user.status !== 'active') {
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
