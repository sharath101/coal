import {
  WIDGET_INFOS,
  layoutFor,
  mayUseWidget,
  widgetByKey,
  type WidgetData,
  type WidgetKey,
} from '@coal/shared';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { ROLES } from '../org/catalogue';
import { toError } from '../permissions';
import { loadCalendar, loadSettings } from '../schedule/calendar';
import { dateOfInstant } from '@coal/shared';
import type { WidgetContext, WidgetHandler } from './context';
import { delaysAndRisks } from './delays';
import { messages } from './messages';
import { howItsGoing, teamWorkload } from './people';
import { myProjects, pipeline, upcomingCheckpoints } from './projects';
import { comingUp, myTasks, waitingSignature } from './tasks';

const HANDLERS: Record<WidgetKey, WidgetHandler> = {
  'my-tasks': myTasks,
  'waiting-signature': waitingSignature,
  'coming-up': comingUp,
  'upcoming-checkpoints': upcomingCheckpoints,
  'my-projects': myProjects,
  pipeline,
  'delays-risks': delaysAndRisks,
  'team-workload': teamWorkload,
  'how-its-going': howItsGoing,
  messages,
};

/** The widgets this person may use, and their layout. */
export function listWidgets(actor: Actor) {
  const allowed = WIDGET_INFOS.filter((w) => mayUseWidget(actor.roleKey, w.key));
  const keys = new Set(allowed.map((w) => w.key));
  return { layout: layoutFor(actor.roleKey).filter((k) => keys.has(k)), widgets: allowed };
}

export async function getWidget(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  key: WidgetKey,
  query: {
    view: 'compact' | 'expanded';
    tab?: string | undefined;
    'filter[project]'?: string | undefined;
    'filter[step]'?: string | undefined;
    'filter[kind]'?: string | undefined;
    'filter[due]'?: string | undefined;
    'filter[line]'?: string | undefined;
    'filter[stage]'?: string | undefined;
    'filter[health]'?: string | undefined;
  },
): Promise<WidgetData> {
  const definition = widgetByKey(key);
  if (!definition || !mayUseWidget(actor.roleKey, key)) {
    const names = new Map(ROLES.map((r) => [r.key, r.name]));
    throw toError({
      allowed: false,
      code: 'NOT_ALLOWED',
      whoCan: (definition?.availableTo ?? []).map((k) => names.get(k) ?? k),
    });
  }
  const now = deps.now();
  const w: WidgetContext = {
    deps,
    ctx,
    actor,
    now,
    today: dateOfInstant(now),
    cal: await loadCalendar(deps.db, ctx.orgId),
    settings: await loadSettings(deps.db, ctx.orgId),
    view: query.view,
    tab: query.tab ?? null,
    filters: {
      project: query['filter[project]'],
      step: query['filter[step]'],
      kind: query['filter[kind]'],
      due: query['filter[due]'],
      line: query['filter[line]'],
      stage: query['filter[stage]'],
      health: query['filter[health]'],
    },
  };
  const body = await HANDLERS[key](w);
  return { key, view: query.view, asOf: now.toISOString(), ...body };
}
