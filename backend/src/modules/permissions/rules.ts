import type { PermissionKey } from '@coal/shared';
import type { Actor } from '../../core/http/context';

/**
 * The one permission module (docs/roles-and-access.md#how-access-is-enforced).
 * Every endpoint's permission has a rule here, checked by the type below, and an entry in
 * the test table in permissions.test.ts.
 */
export type Decision =
  { allowed: true } | { allowed: false; code: 'NOT_SIGNED_IN' | 'NOT_ALLOWED'; whoCan: string[] };

export interface FileResource {
  uploadedBy: string;
}

interface Rule<R> {
  /** Checked before the handler runs, without the record. */
  endpoint: (actor: Actor | null) => Decision;
  /** Checked once the record is loaded. */
  resource?: (actor: Actor, resource: R) => Decision;
}

const allow: Decision = { allowed: true };
const deny = (...whoCan: string[]): Decision => ({ allowed: false, code: 'NOT_ALLOWED', whoCan });

const anyone = (): Decision => allow;
const signedIn = (actor: Actor | null): Decision =>
  actor ? allow : { allowed: false, code: 'NOT_SIGNED_IN', whoCan: ['Anyone signed in'] };

/** Until attachments exist, only the uploader may use a file. Attachments will widen this. */
const uploaderOnly = (actor: Actor, file: FileResource): Decision =>
  actor.userId === file.uploadedBy ? allow : deny('The person who uploaded it');

export const RULES = {
  'auth.signUp': { endpoint: anyone },
  'auth.signIn': { endpoint: anyone },
  'auth.signOut': { endpoint: signedIn },
  'me.read': { endpoint: signedIn },
  'me.update': { endpoint: signedIn },
  'users.read': { endpoint: signedIn },
  'org.read': { endpoint: anyone },
  'rnd.productLines.read': { endpoint: anyone },
  'files.upload': { endpoint: signedIn, resource: uploaderOnly },
  'files.read': { endpoint: signedIn, resource: uploaderOnly },
} satisfies Record<PermissionKey, Rule<never> | Rule<FileResource>>;

type Rules = typeof RULES;
export type ResourceOf<K extends PermissionKey> = Rules[K] extends {
  resource: (actor: Actor, resource: infer R) => Decision;
}
  ? R
  : never;
export type ResourcePermission = {
  [K in PermissionKey]: Rules[K] extends { resource: unknown } ? K : never;
}[PermissionKey];
