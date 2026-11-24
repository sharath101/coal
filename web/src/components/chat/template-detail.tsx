'use client';

import {
  FIELD_SOURCES,
  FIELD_SOURCE_KEYS,
  SIGNATURE_ROW_SETS,
  TemplateSpec,
  getFileLink,
  updateProposal,
  type ActionDetail,
  type FieldSource,
  type SignatureMeaning,
  type Proposal,
  type ProposalAction,
} from '@coal/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/ui/select-class';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useRoles } from '@/lib/queries';
import { cn } from '@/lib/utils';

type TemplateInfo = Extract<ActionDetail, { kind: 'template' }>;

type SourceMessage =
  | 'project_code'
  | 'project_name'
  | 'project_description'
  | 'project_product_line'
  | 'project_stage'
  | 'project_team'
  | 'step_key'
  | 'step_name'
  | 'document_number'
  | 'document_title'
  | 'author_name'
  | 'today'
  | 'person';

/** Message keys can't hold dots, so `project.code` is `project_code`. */
const sourceKey = (from: string) => from.replace('.', '_') as SourceMessage;

/**
 * A short-lived link is fetched and the PDF shown inline, as a local file with its own type, because
 * storage links ask the browser to download (the same way a document's PDF is opened).
 */
export function PdfFrame({
  cacheKey,
  getUrl,
  title,
}: {
  cacheKey: string;
  getUrl: () => Promise<string | null>;
  title: string;
}) {
  const t = useTranslations('workstation.card.template');
  const pdf = useQuery({
    queryKey: ['pdf-preview', cacheKey],
    queryFn: async () => {
      const url = await getUrl();
      if (!url) return null;
      const response = await fetch(url);
      if (!response.ok) return url;
      return URL.createObjectURL(new Blob([await response.blob()], { type: 'application/pdf' }));
    },
    staleTime: Infinity,
  });
  if (pdf.isPending) return <p className="text-xs text-muted-foreground">{t('loadingSample')}</p>;
  if (!pdf.data) return <ProblemMessage error={pdf.error} />;
  return (
    <iframe src={pdf.data} title={title} className="h-[70vh] min-h-96 w-full rounded-md border" />
  );
}

/** The sample PDF of a template, made from made-up data. */
export function SamplePdf({ fileId, title }: { fileId: string; title: string }) {
  return (
    <PdfFrame
      cacheKey={`file:${fileId}`}
      title={title}
      getUrl={async () => (await api(getFileLink, { params: { id: fileId } })).url}
    />
  );
}

/** The template a card would add: its sections, who signs, and the sample PDF. */
export function TemplateDetailView({
  detail,
  onShowSample,
}: {
  detail: TemplateInfo;
  onShowSample?: () => void;
}) {
  const t = useTranslations('workstation.card.template');
  const signed = (detail.signatureRows as SignatureMeaning[])
    .map((row) => {
      const who =
        row === 'reviewed' ? detail.reviewedBy : row === 'approved' ? detail.approvedBy : [];
      return who.length > 0 ? `${t(`row.${row}`)} (${who.join(', ')})` : t(`row.${row}`);
    })
    .join(' → ');
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
      <dl className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="text-muted-foreground">{t('kind')}</dt>
        <dd>
          {detail.documentType.name} · {detail.documentType.code}
          {detail.documentType.firstOfType && (
            <span className="ml-2 text-xs text-muted-foreground">{t('first')}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">{t('steps')}</dt>
        <dd>{detail.steps.join(', ')}</dd>
        <dt className="text-muted-foreground">{t('signed')}</dt>
        <dd>{signed}</dd>
        {detail.madeFrom && (
          <>
            <dt className="text-muted-foreground">{t('madeFrom')}</dt>
            <dd>{detail.madeFrom}</dd>
          </>
        )}
        {detail.layout && (
          <>
            <dt className="text-muted-foreground">{t('layoutLabel')}</dt>
            <dd className={cn(detail.layout === 'rebuilt' && 'text-warning-foreground')}>
              {t(`layout.${detail.layout}`)}
            </dd>
          </>
        )}
      </dl>
      <ol className="grid gap-2">
        {detail.sections.map((s) => (
          <li key={s.id} className="grid gap-0.5 rounded-md bg-background px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{s.title}</span>
              <span className="text-xs text-muted-foreground">
                {s.kind === 'written' ? t('written') : t('fields')}
                {s.required && ` · ${t('required')}`}
              </span>
            </div>
            {s.instructions && <p className="text-xs text-muted-foreground">{s.instructions}</p>}
            {s.fields.length > 0 && (
              <ul className="grid gap-0.5 text-xs">
                {s.fields.map((f) => (
                  <li key={f.name}>
                    <span className="font-medium">{f.label}</span>{' '}
                    <span className="text-muted-foreground">
                      {t(`source.${sourceKey(f.source)}`)}
                      {f.required && ` · ${t('required')}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {detail.sampleFileId && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onShowSample}>
            {t('showSample')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('sampleNote')}</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('draftNote')}</p>
    </div>
  );
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** A card for a template can be edited on screen: what it is called, who signs, and each section's words. */
export const isTemplateCard = (actions: ProposalAction[]) =>
  actions.some((a) => a.endpoint === 'templates.create');

type SpecShape = ReturnType<typeof TemplateSpec.parse>;

interface FieldDraft {
  name: string;
  label: string;
  from: FieldSource;
  required: boolean;
  multiline: boolean;
}
interface SectionDraft {
  id: string;
  kind: 'fields' | 'written';
  title: string;
  instructions: string;
  required: boolean;
  fields: FieldDraft[];
}

const TEXT_SOURCES = FIELD_SOURCE_KEYS.filter((k) => FIELD_SOURCES[k] === 'text');

function toDrafts(spec: SpecShape): SectionDraft[] {
  return spec.sections.map((s) =>
    s.kind === 'written'
      ? {
          id: s.id,
          kind: 'written',
          title: s.title ?? '',
          instructions: s.instructions,
          required: s.required,
          fields: [],
        }
      : {
          id: s.id,
          kind: 'fields',
          title: s.title ?? '',
          instructions: '',
          required: false,
          fields: Object.entries(s.fields).map(([name, f]) => ({
            name,
            label: f.label ?? '',
            from: f.from,
            required: f.required,
            multiline: f.multiline,
          })),
        },
  );
}

/**
 * Changing the words of a template (its name, steps, who signs, each section's title and
 * instructions, a field's label, source and whether it is required) previews the card again. A
 * change that moves a placeholder is made by asking the assistant, which builds the file again.
 */
export function EditTemplateDialog({
  proposal,
  onOpenChange,
  onSaved,
}: {
  proposal: Proposal;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('workstation.card.template');
  const tc = useTranslations('workstation.card');
  const id = useId();
  const roles = useRoles();
  const templateIndex = proposal.actions.findIndex((a) => a.endpoint === 'templates.create');
  const typeIndex = proposal.actions.findIndex((a) => a.endpoint === 'documentTypes.create');
  const templateBody = asRecord(proposal.actions[templateIndex]?.body);
  const spec = TemplateSpec.parse(templateBody.spec);

  const typeBody = asRecord(proposal.actions[typeIndex]?.body);
  const [name, setName] = useState(spec.template);
  // A new kind of document has its own name, which is not always the template's.
  const [typeName, setTypeName] = useState(
    typeof typeBody.name === 'string' ? typeBody.name : spec.template,
  );
  const [steps, setSteps] = useState(spec.steps.join(', '));
  const [notes, setNotes] = useState(
    typeof templateBody.notes === 'string' ? templateBody.notes : '',
  );
  const [rows, setRows] = useState(spec.signature_rows.join(','));
  const [reviewedBy, setReviewedBy] = useState(spec.reviewed_by);
  const [approvedBy, setApprovedBy] = useState(spec.approved_by);
  const [sections, setSections] = useState(() => toDrafts(spec));

  const patchSection = (i: number, patch: Partial<SectionDraft>) =>
    setSections((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const patchField = (i: number, k: number, patch: Partial<FieldDraft>) =>
    setSections((all) =>
      all.map((s, j) =>
        j === i ? { ...s, fields: s.fields.map((f, m) => (m === k ? { ...f, ...patch } : f)) } : s,
      ),
    );
  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  const stepList = steps
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const signatureRows = rows.split(',').filter(Boolean) as SpecShape['signature_rows'];
  const reviewed = signatureRows.includes('reviewed');

  const save = useMutation({
    mutationFn: () => {
      const nextSpec = {
        ...spec,
        template: name.trim(),
        steps: stepList,
        signature_rows: signatureRows,
        reviewed_by: reviewed ? reviewedBy : [],
        approved_by: approvedBy,
        sections: spec.sections.map((original, i) => {
          const d = sections[i] as SectionDraft;
          const title = d.title.trim();
          if (original.kind === 'written') {
            return {
              ...original,
              ...(title ? { title } : {}),
              instructions: d.instructions.trim(),
              required: d.required,
            };
          }
          return {
            ...original,
            ...(title ? { title } : {}),
            fields: Object.fromEntries(
              Object.entries(original.fields).map(([fieldName, f]) => {
                const edited = d.fields.find((x) => x.name === fieldName) as FieldDraft;
                const label = edited.label.trim();
                return [
                  fieldName,
                  {
                    ...f,
                    ...(label ? { label } : {}),
                    from: edited.from,
                    required: edited.required,
                    multiline: edited.multiline,
                  },
                ];
              }),
            ),
          };
        }),
      };
      const actions = proposal.actions.map((a, i) => {
        if (i === templateIndex) return { ...a, body: { ...templateBody, spec: nextSpec, notes } };
        if (i === typeIndex) {
          return {
            ...a,
            body: {
              ...asRecord(a.body),
              name: typeName.trim(),
              steps: stepList,
              signatureRows,
              reviewedBy: reviewed ? reviewedBy : [],
              approvedBy,
            },
          };
        }
        return a;
      });
      return api(updateProposal, {
        params: { id: proposal.id },
        ifMatch: String(proposal.version),
        body: { actions },
      });
    },
    onSuccess: onSaved,
  });

  const roleBoxes = (selected: string[], onToggle: (key: string) => void, group: string) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {(roles.data?.roles ?? []).map((r) => (
        <label key={r.key} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            name={group}
            checked={selected.includes(r.key)}
            onChange={() => onToggle(r.key)}
          />
          {r.name}
        </label>
      ))}
    </div>
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="text-lg font-semibold">{t('editTitle')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('editIntro')}
        </DialogDescription>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {typeIndex >= 0 && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-type`}>{t('fieldTypeName')}</Label>
              <Input
                id={`${id}-type`}
                value={typeName}
                maxLength={120}
                onChange={(e) => setTypeName(e.target.value)}
              />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>{t('fieldName')}</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-steps`}>{t('fieldSteps')}</Label>
              <Input id={`${id}-steps`} value={steps} onChange={(e) => setSteps(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-rows`}>{t('fieldRows')}</Label>
            <select
              id={`${id}-rows`}
              className={selectClass}
              value={rows}
              onChange={(e) => setRows(e.target.value)}
            >
              {SIGNATURE_ROW_SETS.map((set) => (
                <option key={set.join(',')} value={set.join(',')}>
                  {set.map((row) => t(`row.${row}`)).join(' → ')}
                </option>
              ))}
            </select>
          </div>
          {reviewed && (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('fieldReviewedBy')}</legend>
              {roleBoxes(reviewedBy, (k) => setReviewedBy((l) => toggle(l, k)), 'reviewed')}
            </fieldset>
          )}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('fieldApprovedBy')}</legend>
            <p className="text-xs text-muted-foreground">{t('approvedByHelp')}</p>
            {roleBoxes(approvedBy, (k) => setApprovedBy((l) => toggle(l, k)), 'approved')}
          </fieldset>

          <div className="grid gap-4">
            {sections.map((s, i) => (
              <fieldset key={s.id} className="grid gap-2 rounded-lg border p-3">
                <legend className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {s.kind === 'written' ? t('written') : t('fields')}
                </legend>
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-${i}-title`}>{t('fieldSectionTitle')}</Label>
                  <Input
                    id={`${id}-${i}-title`}
                    value={s.title}
                    maxLength={120}
                    onChange={(e) => patchSection(i, { title: e.target.value })}
                  />
                </div>
                {s.kind === 'written' ? (
                  <>
                    <div className="grid gap-2">
                      <Label htmlFor={`${id}-${i}-instructions`}>{t('fieldInstructions')}</Label>
                      <Textarea
                        id={`${id}-${i}-instructions`}
                        rows={3}
                        maxLength={2000}
                        value={s.instructions}
                        onChange={(e) => patchSection(i, { instructions: e.target.value })}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={s.required}
                        onChange={(e) => patchSection(i, { required: e.target.checked })}
                      />
                      {t('fieldRequired')}
                    </label>
                  </>
                ) : (
                  s.fields.map((f, k) => (
                    <div
                      key={f.name}
                      className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <div className="grid gap-1">
                        <Label htmlFor={`${id}-${i}-${k}-label`}>{t('fieldLabel')}</Label>
                        <Input
                          id={`${id}-${i}-${k}-label`}
                          value={f.label}
                          maxLength={80}
                          onChange={(e) => patchField(i, k, { label: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`${id}-${i}-${k}-from`}>{t('fieldSource')}</Label>
                        {FIELD_SOURCES[f.from] === 'table' ? (
                          <p className="py-2 text-sm text-muted-foreground">
                            {t(`source.${sourceKey(f.from)}`)}
                          </p>
                        ) : (
                          <select
                            id={`${id}-${i}-${k}-from`}
                            className={selectClass}
                            value={f.from}
                            onChange={(e) =>
                              patchField(i, k, { from: e.target.value as FieldSource })
                            }
                          >
                            {TEXT_SOURCES.map((from) => (
                              <option key={from} value={from}>
                                {t(`source.${sourceKey(from)}`)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {FIELD_SOURCES[f.from] !== 'table' && (
                        <label className="flex items-center gap-2 self-end pb-2 text-sm">
                          <input
                            type="checkbox"
                            checked={f.required}
                            onChange={(e) => patchField(i, k, { required: e.target.checked })}
                          />
                          {t('fieldRequired')}
                        </label>
                      )}
                    </div>
                  ))
                )}
              </fieldset>
            ))}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-notes`}>{t('fieldNotes')}</Label>
            <Textarea
              id={`${id}-notes`}
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <ProblemMessage error={save.error} />
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={save.isPending || name.trim().length < 3 || typeName.trim().length < 3}
            >
              {tc('save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc('cancelEdit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
