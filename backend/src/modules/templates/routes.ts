import {
  activateTemplate as activateTemplateEndpoint,
  createTemplate,
  getActiveTemplate,
  getTemplate,
  getTemplateLinks,
  listDocumentTypes as listDocumentTypesEndpoint,
  listTemplates,
} from '@coal/shared';
import { implement } from '../../core/http/endpoint';
import { notFound } from '../../core/http/errors';
import { linkTo } from '../files/service';
import { assertCanAccess } from '../permissions';
import {
  activateTemplate,
  activeTemplate,
  addTemplateFromUpload,
  canManageTemplates,
  findTemplate,
  findTypeByCode,
  listDocumentTypes,
  listTemplates as listTemplateRows,
  presentTemplate,
  templateFiles,
} from './service';

export const templatesRoutes = [
  implement(listDocumentTypesEndpoint, async ({ deps, ctx }) => ({
    items: await listDocumentTypes(deps.db, ctx.orgId),
  })),

  implement(listTemplates, async ({ deps, ctx, actor, query }) => ({
    items: await listTemplateRows(deps.db, ctx.orgId, actor, query),
  })),

  implement(getActiveTemplate, async ({ deps, ctx, actor, query }) => {
    const type = await findTypeByCode(deps.db, ctx.orgId, query.documentType);
    const row = type ? await activeTemplate(deps.db, ctx.orgId, type.id) : null;
    if (!row) throw notFound('active template for this document type');
    assertCanAccess('templates.read', actor, { status: row.status });
    return presentTemplate(deps.db, ctx.orgId, actor, row);
  }),

  implement(getTemplate, async ({ deps, ctx, actor, params }) => {
    const row = await findTemplate(deps.db, ctx.orgId, params.id);
    if (!row) throw notFound('template');
    assertCanAccess('templates.read', actor, { status: row.status });
    return presentTemplate(deps.db, ctx.orgId, actor, row);
  }),

  implement(createTemplate, async ({ deps, ctx, actor, body }) => {
    const row = await addTemplateFromUpload(deps, ctx, actor, body);
    return presentTemplate(deps.db, ctx.orgId, actor, row);
  }),

  implement(activateTemplateEndpoint, async ({ deps, ctx, actor, params }) => {
    const row = await activateTemplate(deps, ctx, actor, params.id);
    return presentTemplate(deps.db, ctx.orgId, actor, row);
  }),

  implement(getTemplateLinks, async ({ deps, ctx, actor, params }) => {
    const row = await findTemplate(deps.db, ctx.orgId, params.id);
    if (!row) throw notFound('template');
    assertCanAccess('templates.read', actor, { status: row.status });
    const files = await templateFiles(deps.db, ctx.orgId, row);
    return {
      sample: files.sample ? await linkTo(deps, files.sample) : null,
      // The Word file is for the people who manage the library.
      docx: files.docx && canManageTemplates(actor) ? await linkTo(deps, files.docx) : null,
    };
  }),
];
