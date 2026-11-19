import { readFile } from 'node:fs/promises';
import type Anthropic from '@anthropic-ai/sdk';
import { getProject, getStep, getTeam, getProcessStep, getMe } from '@coal/shared';
import { z } from 'zod';
import { findDraft, presentDraft } from './chats';
import { DraftContent, GAP_PATTERN } from './documents/content';
import { toPdf } from './documents/convert';
import { buildDocx } from './documents/docx';
import {
  findTemplates,
  letterheadDocx,
  templateForModel,
  type TemplateFile,
} from './documents/library';
import { callEndpoint } from './endpoint-call';
import { structured } from './gateway';
import { modelName, resolvePurpose } from './models';
import { aiDrafts } from './tables';
import type { ToolContext, ToolOutcome } from './tools';

/**
 * Drafting a document (docs/workstation-and-ai.md#drafting-a-document). Every time, it checks the
 * step's templates on disk; the drafting model follows the chosen one, or writes a new document in
 * the same style on the letterhead when the step has none.
 */

const USABLE: TemplateFile['kind'][] = ['docx', 'pdf', 'xlsx'];

export async function templateList(stepKey: string) {
  const files = await findTemplates(stepKey);
  return {
    stepKey,
    templates: files
      .filter((f) => USABLE.includes(f.kind))
      .map((f) => ({ file: f.name, kind: f.kind })),
    notes: files.filter((f) => f.kind === 'note').map((f) => f.note ?? f.name),
  };
}

async function modelContent(file: TemplateFile): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const t = await templateForModel(file);
  return t.kind === 'pdf'
    ? [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: t.data.toString('base64'),
          },
          title: file.name,
        },
      ]
    : [{ type: 'text', text: `Template “${file.name}”:\n${t.text}` }];
}

export async function readTemplate(stepKey: string, name: string): Promise<ToolOutcome> {
  const file = (await findTemplates(stepKey)).find((f) => f.name === name);
  if (!file) return { content: `No file called “${name}” for step ${stepKey}.`, isError: true };
  return {
    content: (await modelContent(file)) as Anthropic.Beta.BetaToolResultBlockParam['content'],
  };
}

export async function readDraft(tc: ToolContext, id: string): Promise<ToolOutcome> {
  const draft = await findDraft(tc.deps.db, tc.ctx.orgId, id);
  if (!draft || draft.userId !== tc.ctx.actor!.userId) {
    return { content: 'No such draft in your chats.', isError: true };
  }
  if (!draft.pdf) return { content: JSON.stringify(draft.content) };
  return {
    content: [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: draft.pdf.toString('base64'),
        },
        title: draft.title,
      },
    ],
  };
}

const PickOutput = z.object({ file: z.string(), reason: z.string() });

/** When a step has several templates, the cheap model picks the one the request is for. */
async function pickTemplate(
  tc: ToolContext,
  candidates: TemplateFile[],
  request: string,
): Promise<TemplateFile | null> {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const purpose = resolvePurpose('template_pick', tc.deps.config.ai.modelOverrides);
  const { value, call } = await structured(
    { deps: tc.deps, ctx: tc.ctx, chatId: tc.chat.id },
    purpose,
    {
      system:
        'Pick the one template file that matches the request. Answer with its exact file name, or "" if none fits.',
      messages: [
        {
          role: 'user',
          content: `Request: ${request}\n\nFiles:\n${candidates.map((c) => `- ${c.name}`).join('\n')}`,
        },
      ],
      schema: PickOutput,
    },
  );
  tc.calls.push(call);
  return candidates.find((c) => c.name === value.file) ?? null;
}

const WRITER = `You draft controlled documents for Jayon's R&D department. Jayon makes orthopaedic implants and instruments under ISO 13485, so every document is a record people sign.

Write the document as structured content in the schema. A program lays it out on Jayon's own Word template or letterhead, so don't add styling; just get the structure and words right.

When a template is attached:
- Follow it exactly: the same title, form or document number, section order, field labels, table columns and signature rows. Keep its wording for fixed text.
- Templates marked BP are boilerplates and may hold another project's example values. Never copy those values. Fill each field from the facts given, or mark it as a gap.

When there is no template:
- Write the document in the style of Jayon's other R&D forms: the title, a document number gap, a fields block (Project code, Project name, Product line, Step, Prepared by, Date, Revision 00), then the sections this step's outputs need, then signature rows (Prepared by the person asking; Reviewed by; Approved by the step's signer role).

Always:
- Facts come only from the facts and the request given. Never invent names, dates, numbers, prices, test results, standards clauses or regulatory references.
- Anything you don't have is a gap: write [[to fill: what is needed]] in its place, always saying what is needed (also in table cells), and list every gap in plain words in "gaps".
- Written sections (purpose, scope, method, conclusions) are concise and professional. Where the request gives no basis, write a short frame and mark what's missing as a gap.
- Dates are written like 19 Nov 2026.`;

export async function draftDocument(
  tc: ToolContext,
  input: { stepKey: string; request: string; projectId?: string | undefined },
): Promise<ToolOutcome> {
  const scope = { deps: tc.deps, ctx: tc.ctx, chatId: tc.chat.id };
  tc.activity(`Checked Jayon’s templates for step ${input.stepKey}`);
  const files = await findTemplates(input.stepKey);
  const notes = files.filter((f) => f.kind === 'note').map((f) => f.note?.trim() || f.name);
  const template = await pickTemplate(
    tc,
    files.filter((f) => USABLE.includes(f.kind)),
    input.request,
  );

  // Facts, gathered as the person: they can only draft from what they may see.
  const facts: Record<string, unknown> = {};
  const call = async (
    key: string,
    endpoint: Parameters<typeof callEndpoint>[1],
    params?: Record<string, unknown>,
  ) => {
    const r = await callEndpoint(tc.request, endpoint, params ? { params } : {}, { viaAi: true });
    // COAL's own bookkeeping (open-question ids) means nothing in a Jayon document.
    if (r.ok)
      facts[key] = JSON.parse(JSON.stringify(r.json), (k, v: unknown) =>
        k === 'assumptions' ? undefined : v,
      );
  };
  await call('preparedBy', getMe);
  await call('stepDefinition', getProcessStep, { key: 'rnd-route', step: input.stepKey });
  if (input.projectId) {
    tc.activity('Gathered the project’s details and team');
    await Promise.all([
      call('project', getProject, { id: input.projectId }),
      call('team', getTeam, { id: input.projectId }),
      call('stepStatus', getStep, { id: input.projectId, key: input.stepKey }),
    ]);
  }

  const writer = resolvePurpose('draft_write', tc.deps.config.ai.modelOverrides);
  tc.activity(
    template
      ? `${modelName(writer.model)} is writing it from “${template.name}”`
      : `No template for step ${input.stepKey}: ${modelName(writer.model)} is writing one on the letterhead`,
  );
  const today = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(template ? await modelContent(template) : []),
    {
      type: 'text',
      text: [
        template
          ? `Template: “${template.name}” (attached above).`
          : `There is no template for step ${input.stepKey}.${notes.length ? ` Jayon's note in the folder: ${notes.join(' / ')}` : ''}`,
        `Today: ${today}.`,
        `Request: ${input.request}`,
        `Facts (from COAL's records, as JSON):\n${JSON.stringify(facts, null, 1)}`,
      ].join('\n\n'),
    },
  ];
  const { value, call: writeCall } = await structured(scope, writer, {
    system: WRITER,
    messages: [{ role: 'user', content }],
    schema: DraftContent,
  });
  tc.calls.push(writeCall);

  const gapsInText = [...JSON.stringify(value.blocks).matchAll(GAP_PATTERN)]
    .map((m) => (m[1] ?? '').trim())
    .filter(Boolean);
  const gaps = value.gaps.length ? value.gaps : [...new Set(gapsInText)];

  tc.activity('Laid it out in Word and PDF');
  const base = template?.kind === 'docx' ? await readFile(template.path) : await letterheadDocx();
  const docx = await buildDocx(base, value);
  let pdf: Buffer | null = null;
  try {
    pdf = await toPdf(docx, 'draft.docx');
  } catch (error) {
    tc.request.log.warn({ err: error }, 'draft PDF conversion failed');
  }
  const [row] = await tc.deps.db
    .insert(aiDrafts)
    .values({
      orgId: tc.ctx.orgId,
      userId: tc.ctx.actor!.userId,
      chatId: tc.chat.id,
      projectId: input.projectId ?? null,
      stepKey: input.stepKey,
      title: value.title,
      template: template ? `${template.folder}/${template.name}` : null,
      model: writeCall.model,
      content: value,
      gaps,
      docx,
      pdf,
    })
    .returning();
  const draft = presentDraft(row!);
  tc.draft(draft);
  return {
    content: JSON.stringify({
      draftId: draft.id,
      title: draft.title,
      template: template ? template.name : 'none: written on the letterhead',
      folderNotes: notes,
      gaps,
      shown: 'The draft is open in the person’s preview pane, with PDF and Word downloads.',
    }),
  };
}
