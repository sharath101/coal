'use client';

import {
  OPENFDA_DATASETS,
  RESEARCH_SOURCE_KINDS,
  createResearchSource,
  updateResearchSource,
  type OpenFdaDataset,
  type ResearchSource,
  type ResearchSourceKind,
  type ResearchSourceSettings,
} from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/role-fields';
import { Pill } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { queryKeys, useMe, useResearchSources } from '@/lib/queries';
import { canManageSources } from '@/lib/roles';

/**
 * The source library (docs/workstation-and-ai.md#the-source-library): where research may search,
 * and when to use each place. Everyone sees it; the VP, the R&D Head and the R&D Leads keep it.
 */
export default function SourceLibraryPage() {
  const t = useTranslations('sourceLibrary');
  const me = useMe();
  const sources = useResearchSources();
  const [editing, setEditing] = useState<ResearchSource | 'new' | null>(null);
  const manager = !!me.data && canManageSources(me.data.role.key);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 p-6">
      <Link
        href="/research"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('manageNote')}</p>
        </div>
        {manager && <Button onClick={() => setEditing('new')}>{t('add')}</Button>}
      </div>

      <ProblemMessage error={sources.error} />
      {sources.isPending && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
      <ul className="grid gap-2">
        {(sources.data ?? []).map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            manager={manager}
            onEdit={() => setEditing(source)}
          />
        ))}
      </ul>

      {editing && (
        <SourceDialog
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function useSettingsText() {
  const t = useTranslations('sourceLibrary');
  return (settings: ResearchSourceSettings): string => {
    switch (settings.kind) {
      case 'openfda':
        return settings.datasets.map((d) => t(`datasets.${d}`)).join(', ');
      case 'journal':
        return settings.pubmedTitle
          ? t('journalPubmed', { issn: settings.issn, title: settings.pubmedTitle })
          : t('journalCrossref', { issn: settings.issn });
      case 'website':
        return settings.domains.join(', ');
      case 'link':
        return settings.url;
      default:
        // PubMed, Europe PMC and ClinicalTrials.gov have nothing to set: their kind says it all.
        return '';
    }
  };
}

function SourceRow({
  source,
  manager,
  onEdit,
}: {
  source: ResearchSource;
  manager: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations('sourceLibrary');
  const tConfirm = useTranslations('confirm.source');
  const settingsText = useSettingsText();
  const queryClient = useQueryClient();
  const [confirmingToggle, setConfirmingToggle] = useState(false);
  const toggle = useMutation({
    mutationFn: () =>
      api(updateResearchSource, { params: { id: source.id }, body: { enabled: !source.enabled } }),
    onSuccess: () => {
      setConfirmingToggle(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.researchSources });
    },
  });
  const turning = source.enabled ? 'off' : 'on';

  return (
    <li className="grid gap-1 rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{source.name}</span>
          <span className="text-xs text-muted-foreground">{t(`kinds.${source.kind}`)}</span>
          {!source.enabled ? (
            <Pill tone="neutral">{t('off')}</Pill>
          ) : source.searchable ? (
            <Pill tone="good">{t('searchable')}</Pill>
          ) : (
            <Pill tone="waiting">{t('linkOnly')}</Pill>
          )}
        </span>
        {manager && (
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit}>
              {t('edit')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                toggle.reset();
                setConfirmingToggle(true);
              }}
              disabled={toggle.isPending}
            >
              {source.enabled ? t('switchOff') : t('switchOn')}
            </Button>
            <ConfirmDialog
              open={confirmingToggle}
              onOpenChange={setConfirmingToggle}
              title={tConfirm(`${turning}Title`, { name: source.name })}
              text={tConfirm(`${turning}Text`)}
              confirmLabel={tConfirm(`${turning}Yes`)}
              pending={toggle.isPending}
              error={toggle.error}
              onConfirm={() => toggle.mutate()}
            />
          </span>
        )}
      </div>
      {settingsText(source.settings) && (
        <p className="text-xs break-all text-muted-foreground">{settingsText(source.settings)}</p>
      )}
      {source.note && <p>{source.note}</p>}
      {source.kind === 'website' && !source.searchable && (
        <p className="text-xs text-muted-foreground">{t('websiteNote')}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {source.addedBy ? t('addedBy', { name: source.addedBy.name }) : t('fromCoal')}
      </p>
      <ProblemMessage error={toggle.error} />
    </li>
  );
}

interface Draft {
  name: string;
  note: string;
  kind: ResearchSourceKind;
  datasets: OpenFdaDataset[];
  issn: string;
  pubmedTitle: string;
  domains: string;
  url: string;
}

const draftOf = (source: ResearchSource | null): Draft => {
  const s = source?.settings;
  return {
    name: source?.name ?? '',
    note: source?.note ?? '',
    kind: s?.kind ?? 'journal',
    datasets: s?.kind === 'openfda' ? s.datasets : ['510k'],
    issn: s?.kind === 'journal' ? s.issn : '',
    pubmedTitle: s?.kind === 'journal' ? (s.pubmedTitle ?? '') : '',
    domains: s?.kind === 'website' ? s.domains.join('\n') : '',
    url: s?.kind === 'link' ? s.url : '',
  };
};

function settingsOf(d: Draft): ResearchSourceSettings {
  switch (d.kind) {
    case 'openfda':
      return { kind: 'openfda', datasets: d.datasets };
    case 'journal':
      return {
        kind: 'journal',
        issn: d.issn.trim(),
        ...(d.pubmedTitle.trim() && { pubmedTitle: d.pubmedTitle.trim() }),
      };
    case 'website':
      return {
        kind: 'website',
        domains: d.domains
          .split(/[\s,]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      };
    case 'link':
      return { kind: 'link', url: d.url.trim() };
    default:
      return { kind: d.kind };
  }
}

function SourceDialog({ source, onClose }: { source: ResearchSource | null; onClose: () => void }) {
  const t = useTranslations('sourceLibrary');
  const id = useId();
  const queryClient = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftOf(source));
  const set = (patch: Partial<Draft>) => setD((all) => ({ ...all, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: d.name, note: d.note, settings: settingsOf(d) };
      return source
        ? api(updateResearchSource, { params: { id: source.id }, body })
        : api(createResearchSource, { body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.researchSources });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {source ? t('editTitle') : t('addTitle')}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('dialogIntro')}
        </DialogDescription>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>{t('fieldName')}</Label>
            <Input
              id={`${id}-name`}
              value={d.name}
              maxLength={80}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-kind`}>{t('fieldKind')}</Label>
            <select
              id={`${id}-kind`}
              className={selectClass}
              value={d.kind}
              onChange={(e) => set({ kind: e.target.value as ResearchSourceKind })}
            >
              {RESEARCH_SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
          </div>

          {d.kind === 'openfda' && (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('fieldDatasets')}</legend>
              {OPENFDA_DATASETS.map((ds) => (
                <label key={ds} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={d.datasets.includes(ds)}
                    onChange={(e) =>
                      set({
                        datasets: e.target.checked
                          ? [...d.datasets, ds]
                          : d.datasets.filter((x) => x !== ds),
                      })
                    }
                  />
                  {t(`datasets.${ds}`)}
                </label>
              ))}
            </fieldset>
          )}
          {d.kind === 'journal' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-issn`}>{t('fieldIssn')}</Label>
                <Input
                  id={`${id}-issn`}
                  value={d.issn}
                  placeholder={t('issnPlaceholder')}
                  onChange={(e) => set({ issn: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-pubmed`}>{t('fieldPubmedTitle')}</Label>
                <Input
                  id={`${id}-pubmed`}
                  value={d.pubmedTitle}
                  onChange={(e) => set({ pubmedTitle: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t('pubmedTitleHelp')}</p>
            </div>
          )}
          {d.kind === 'website' && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-domains`}>{t('fieldDomains')}</Label>
              <Textarea
                id={`${id}-domains`}
                rows={3}
                value={d.domains}
                onChange={(e) => set({ domains: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t('websiteNote')}</p>
            </div>
          )}
          {d.kind === 'link' && (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-url`}>{t('fieldUrl')}</Label>
              <Input
                id={`${id}-url`}
                value={d.url}
                onChange={(e) => set({ url: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t('urlHelp')}</p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor={`${id}-note`}>{t('fieldNote')}</Label>
            <Textarea
              id={`${id}-note`}
              rows={3}
              maxLength={500}
              value={d.note}
              onChange={(e) => set({ note: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('noteHelp')}</p>
          </div>

          <ProblemMessage error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending || d.name.trim().length < 2}>
              {t('save')}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
