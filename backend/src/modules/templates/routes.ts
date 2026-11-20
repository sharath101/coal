import {
  FIELD_SOURCES,
  fieldLabel,
  specTitle,
  type ActionDetail,
  activateTemplate as activateTemplateEndpoint,
  createDocumentType as createDocumentTypeEndpoint,
  createTemplate,
  getActiveTemplate,
  getTemplate,
  getTemplateLinks,
  listDocumentTypes as listDocumentTypesEndpoint,
  listTemplates,
  prepareTemplate as prepareTemplateEndpoint,
  readSample as readSampleEndpoint,
} from '@coal/shared';
import { implement, noEffects } from '../../core/http/endpoint';
import { notFound } from '../../core/http/errors';
import { findDerivedFile, findFiles, linkTo } from '../files/service';
import { listRoles } from '../org/service';
import { assertCanAccess } from '../permissions';
import {
  activateTemplate,
  activeTemplate,
  addTemplateFromUpload,
  canManageTemplates,
  createDocumentType,
  findTemplate,
  findTypeByCode,
  listDocumentTypes,
  listTemplates as listTemplateRows,
  presentTemplate,
  templateFiles,
} from './service';
import { prepareTemplate, readSampleOutline } from './sample';

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

  implement(
    createTemplate,
    async ({ deps, ctx, actor, body }) => {
      const row = await addTemplateFromUpload(deps, ctx, actor, body);
      return presentTemplate(deps.db, ctx.orgId, actor, row);
    },
    {
      describe: async (template, { body }, deps) => {
        const orgId = deps.config.orgId;
        const roles = new Map((await listRoles(deps.db, orgId)).map((r) => [r.key, r.name]));
        const roleNames = (keys: string[]) => keys.map((k) => roles.get(k) ?? k);

        // What the sample was, and the sample PDF COAL made from made-up data, for the person to look at.
        const [docx] = await findFiles(deps.db, orgId, [body.docxFileId]);
        const [origin] = docx?.derivedFrom
          ? await findFiles(deps.db, orgId, [docx.derivedFrom])
          : [];
        const pdf = await findDerivedFile(deps.db, orgId, body.docxFileId);

        const detail: ActionDetail = {
          kind: 'template',
          documentType: {
            code: template.documentType.code,
            name: template.documentType.name,
            firstOfType: template.version === 1,
          },
          name: template.name,
          steps: template.steps,
          version: template.version,
          layout: origin ? (origin.name.toLowerCase().endsWith('.pdf') ? 'rebuilt' : 'kept') : null,
          madeFrom: origin?.name ?? null,
          sampleFileId: pdf?.id ?? null,
          signatureRows: template.spec.signature_rows,
          reviewedBy: roleNames(template.spec.reviewed_by),
          approvedBy: roleNames(template.spec.approved_by),
          sections: template.spec.sections.map((s) => ({
            id: s.id,
            title: specTitle(s),
            kind: s.kind,
            required: s.kind === 'written' ? s.required : false,
            instructions: s.kind === 'written' ? s.instructions : null,
            fields:
              s.kind === 'fields'
                ? Object.entries(s.fields).map(([name, f]) => ({
                    name,
                    label: fieldLabel(name, f),
                    source: f.from,
                    required: FIELD_SOURCES[f.from] === 'table' ? false : f.required,
                  }))
                : [],
          })),
        };
        return {
          summary: `Add the ${template.documentType.name} template as a draft (version ${template.version}, ${template.spec.sections.length} sections)`,
          effects: noEffects(),
          notified: [],
          detail,
        };
      },
    },
  ),

  implement(
    createDocumentTypeEndpoint,
    async ({ deps, ctx, body }) => createDocumentType(deps, ctx, body),
    {
      describe: (type, { body }) => ({
        summary: `Add the document type ${type.name} (${type.code}) for step ${type.stepKeys.join(', ')}, signed in ${body.signatureRows.join(', ')}`,
        effects: noEffects(),
        notified: [],
      }),
    },
  ),

  implement(readSampleEndpoint, async ({ deps, ctx, actor, query }) =>
    readSampleOutline(deps, ctx, actor, query.fileId),
  ),

  implement(prepareTemplateEndpoint, async ({ deps, ctx, actor, body }) =>
    prepareTemplate(deps, ctx, actor, body),
  ),

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
