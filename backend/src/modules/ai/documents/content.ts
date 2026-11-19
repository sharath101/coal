import { z } from 'zod';

/**
 * A drafted document as structured content. The drafting model writes this (structured output);
 * docx.ts lays it out on the template's or the letterhead's Word file.
 *
 * Gaps: any text written as `[[to fill: what]]` is something COAL doesn't hold and the person
 * must supply. The Word file highlights it, and `gaps` lists each one.
 */
export const DraftBlock = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    level: z.enum(['1', '2', '3']),
    text: z.string(),
  }),
  z.object({ type: z.literal('paragraph'), text: z.string() }),
  /** Label and value pairs, such as a form's header fields. */
  z.object({
    type: z.literal('fields'),
    items: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
  z.object({
    type: z.literal('table'),
    header: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  z.object({ type: z.literal('list'), ordered: z.boolean(), items: z.array(z.string()) }),
  /** Signature rows: Prepared by, Reviewed by, Approved by, each with a name and a blank to sign. */
  z.object({
    type: z.literal('signatures'),
    rows: z.array(z.object({ role: z.string(), name: z.string() })),
  }),
]);
export type DraftBlock = z.infer<typeof DraftBlock>;

export const DraftContent = z.object({
  title: z.string(),
  /** The form or document number printed on the template, or an empty string. */
  documentNumber: z.string(),
  blocks: z.array(DraftBlock),
  /** Every `[[to fill: …]]` in the blocks, in plain words. */
  gaps: z.array(z.string()),
});
export type DraftContent = z.infer<typeof DraftContent>;

/** `[[to fill: what]]`, or a bare `[[to fill]]` in a table cell. Group 1 is the "what", if any. */
export const GAP_PATTERN = /\[\[to fill(?::\s*([^\]]*))?\]\]/g;
