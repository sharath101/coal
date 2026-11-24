import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db, Tx } from '../../core/db/client';
import type { Actor } from '../../core/http/context';
import { findUser, positionOf } from '../users/service';
import { sessions } from './tables';

// Name-only sign-in is a placeholder (docs/roles-and-access.md#accounts-for-now). Everything
// outside this module uses only the Actor it resolves, so real sign-in replaces just this module.

export const SESSION_COOKIE = 'coal_session';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function startSession(
  tx: Tx,
  orgId: string,
  userId: string,
  options: { days: number; device: string | null; switchedById?: string | null },
) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + options.days * 24 * 3600_000);
  const [row] = await tx
    .insert(sessions)
    .values({
      orgId,
      userId,
      tokenHash: hashToken(token),
      device: options.device,
      expiresAt,
      switchedById: options.switchedById ?? null,
    })
    .returning({ id: sessions.id });
  return { id: row!.id, token, expiresAt };
}

export async function endSession(tx: Tx, orgId: string, sessionId: string) {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.orgId, orgId), eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/**
 * The person behind a session token. `adminSwitching` is the demo's setting: off, the admin can't
 * be signed in, and a session reached by switching no longer counts (P113).
 */
export async function resolveSession(
  db: Db,
  orgId: string,
  token: string,
  options: { adminSwitching: boolean },
): Promise<{ sessionId: string; actor: Actor } | null> {
  const [session] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      switchedById: sessions.switchedById,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.orgId, orgId),
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  if (!session) return null;
  const user = await findUser(db, orgId, session.userId);
  if (!user || user.status !== 'active') return null;
  if (!options.adminSwitching && (user.roleKey === 'admin' || session.switchedById)) return null;
  let switcherId: string | null = null;
  if (options.adminSwitching) {
    if (user.roleKey === 'admin') switcherId = user.id;
    else if (session.switchedById) {
      const admin = await findUser(db, orgId, session.switchedById);
      if (admin?.roleKey === 'admin' && admin.status === 'active') switcherId = admin.id;
    }
  }
  return {
    sessionId: session.id,
    actor: {
      userId: user.id,
      name: user.name,
      roleKey: user.roleKey,
      positionKey: positionOf(user),
      productLineId: user.productLineId,
      switcherId,
    },
  };
}

/** The website sends a cookie; the app, later, a bearer token. */
export function readSessionToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim() || null;
  return request.cookies[SESSION_COOKIE] ?? null;
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean) {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}

export const deviceOf = (request: FastifyRequest) =>
  request.headers['user-agent']?.slice(0, 200) ?? null;
