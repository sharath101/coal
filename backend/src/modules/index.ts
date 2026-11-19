import type { Implementation } from '../core/http/endpoint';
import { attachmentsRoutes } from './attachments/routes';
import { authRoutes } from './auth/routes';
import { documentsRoutes } from './documents/routes';
import { filesRoutes } from './files/routes';
import { orgRoutes } from './org/routes';
import { processRoutes } from './process/routes';
import { rndRoutes } from './rnd/routes';
import { tasksRoutes } from './tasks/routes';
import { templatesRoutes } from './templates/routes';
import { usersRoutes } from './users/routes';

/**
 * Every module's endpoints. Platform modules first; department modules (R&D first) after.
 * The app refuses to start if an endpoint in shared/ has no implementation here.
 */
export const IMPLEMENTATIONS = [
  ...authRoutes,
  ...usersRoutes,
  ...orgRoutes,
  ...filesRoutes,
  ...processRoutes,
  ...templatesRoutes,
  ...tasksRoutes,
  ...rndRoutes,
  ...documentsRoutes,
  ...attachmentsRoutes,
] as unknown as Implementation[];
