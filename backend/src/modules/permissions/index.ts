import type { PermissionKey } from '@coal/shared';
import type { Actor } from '../../core/http/context';
import { AppError } from '../../core/http/errors';
import { RULES, type Decision, type ResourceOf, type ResourcePermission } from './rules';

export type { Decision } from './rules';

/** May this person use the endpoint guarded by `permission`? */
export function canUse(permission: PermissionKey, actor: Actor | null): Decision {
  return RULES[permission].endpoint(actor);
}

/** May this person act on this record? */
export function canAccess<K extends ResourcePermission>(
  permission: K,
  actor: Actor,
  resource: ResourceOf<K>,
): Decision {
  const rule = RULES[permission] as { resource: (a: Actor, r: ResourceOf<K>) => Decision };
  return rule.resource(actor, resource);
}

export function toError(decision: Exclude<Decision, { allowed: true }>): AppError {
  if (decision.code === 'NOT_SIGNED_IN') {
    return new AppError(401, 'NOT_SIGNED_IN', 'Sign in first.');
  }
  return new AppError(
    403,
    'NOT_ALLOWED',
    `Only these people can do this: ${decision.whoCan.join(', ')}.`,
    {
      whoCan: decision.whoCan,
    },
  );
}

export function assertCanUse(permission: PermissionKey, actor: Actor | null): void {
  const decision = canUse(permission, actor);
  if (!decision.allowed) throw toError(decision);
}

export function assertCanAccess<K extends ResourcePermission>(
  permission: K,
  actor: Actor,
  resource: ResourceOf<K>,
): void {
  const decision = canAccess(permission, actor, resource);
  if (!decision.allowed) throw toError(decision);
}
