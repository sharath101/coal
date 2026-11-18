import type { Implementation } from '../core/http/endpoint';
import { authRoutes } from './auth/routes';
import { filesRoutes } from './files/routes';
import { orgRoutes } from './org/routes';
import { rndRoutes } from './rnd/routes';
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
  ...rndRoutes,
] as unknown as Implementation[];
