import type { Implementation } from '../core/http/endpoint';
import { aiRoutes } from './ai/routes';
import { attachmentsRoutes } from './attachments/routes';
import { authRoutes } from './auth/routes';
import { deviationsRoutes } from './deviations/routes';
import { documentsRoutes } from './documents/routes';
import { filesRoutes } from './files/routes';
import { notificationsRoutes } from './notifications/routes';
import { orgRoutes } from './org/routes';
import { processRoutes } from './process/routes';
import { proposalsRoutes } from './proposals/routes';
import { rndRoutes } from './rnd/routes';
import { scheduleRoutes } from './schedule/routes';
import { searchRoutes } from './search/routes';
import { tasksRoutes } from './tasks/routes';
import { templatesRoutes } from './templates/routes';
import { usersRoutes } from './users/routes';
import { widgetsRoutes } from './widgets/routes';

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
  ...scheduleRoutes,
  ...deviationsRoutes,
  ...notificationsRoutes,
  ...widgetsRoutes,
  ...proposalsRoutes,
  ...searchRoutes,
  ...aiRoutes,
] as unknown as Implementation[];
