import { getWidget as getWidgetEndpoint, listWidgets as listWidgetsEndpoint } from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import * as service from './service';

export const widgetsRoutes = [
  implement(listWidgetsEndpoint, async ({ actor }) => service.listWidgets(actor)),

  implement(getWidgetEndpoint, ({ deps, ctx, actor, params, query }) =>
    service.getWidget(deps, ctx, actor, params.key, query),
  ),
];
