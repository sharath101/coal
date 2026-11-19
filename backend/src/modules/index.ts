import type { Implementation } from '../core/http/endpoint';
import { aiRoutes } from './ai/routes';
import { authRoutes } from './auth/routes';
import { filesRoutes } from './files/routes';
import { orgRoutes } from './org/routes';
import { processRoutes } from './process/routes';
import { rndRoutes } from './rnd/routes';
import { tasksRoutes } from './tasks/routes';
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
  ...tasksRoutes,
  ...aiRoutes,
  ...rndRoutes,
] as unknown as Implementation[];
