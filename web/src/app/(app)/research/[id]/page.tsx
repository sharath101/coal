'use client';

import { keepResearch, stopResearch, type ResearchResult, type ResearchRun } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/ui/select-class';
import { RESEARCH_TONE } from '@/components/research/research-card';
import { Pill } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  queryKeys,
  useMe,
  useProjectOptions,
  useProjectRoute,
  useResearchRun,
} from '@/lib/queries';

/** `[R3]` (or `[R2, R5]`) in the brief becomes a link to each result on this page. */
function withRefs(text: string, known: Set<string>): ReactNode[] {
  return text.split(/(\[R\d+(?:\s*[,;]\s*R\d+)*\])/g).map((part, i) => {
    const refs = /^\[(R\d+(?:\s*[,;]\s*R\d+)*)\]$/.exec(part)?.[1]?.split(/\s*[,;]\s*/);
    if (!refs) return <Fragment key={i}>{part}</Fragment>;
    return (
      <Fragment key={i}>
        {refs
          .filter((ref) => known.has(ref))
          .map((ref) => (
            <a
              key={ref}
              href={`#result-${ref}`}
              className="mx-0.5 rounded bg-muted px-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              {ref}
            </a>
          ))}
      </Fragment>
    );
  });
}

/**
 * One research run (docs/workstation-and-ai.md#researching-what-already-exists): the brief, the
 * results to keep as sources of a step, the places to search by hand, and every search that left
 * COAL. Private to the person who ran it.
 */
export default function ResearchRunPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('research');
  const tConfirm = useTranslations('confirm.research');
  const run = useResearchRun(id);
  const queryClient = useQueryClient();
  const [confirmingStop, setConfirmingStop] = useState(false);
  const stop = useMutation({
    mutationFn: () => api(stopResearch, { params: { id } }),
    onSuccess: () => {
      setConfirmingStop(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.research });
    },
  });

  if (run.isPending) return <p className="p-6 text-sm text-muted-foreground">{t('loading')}</p>;
  if (!run.data) {
    return (
      <div className="p-6">
        <ProblemMessage error={run.error} />
      </div>
    );
  }
  const r = run.data;
  const working = r.status === 'queued' || r.status === 'running';
  const refs = new Set(r.results.map((x) => x.ref));

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 p-6">
      <Link
        href="/research"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('back')}
      </Link>

      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={RESEARCH_TONE[r.status]}>{t(`status.${r.status}`)}</Pill>
          <span className="text-xs text-muted-foreground">
            {t('started', { when: formatDateTime(r.createdAt) })}
          </span>
          {r.project && (
            <span className="text-xs text-muted-foreground">
              {r.stepKey
                ? t('forStep', {
                    project: `${r.project.code} · ${r.project.name}`,
                    step: r.stepKey,
                  })
                : t('for', { project: `${r.project.code} · ${r.project.name}` })}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{r.question}</h1>
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('terms')}</span>
          <ul className="flex flex-wrap gap-1.5">
            {r.terms.map((term) => (
              <li key={term} className="rounded-md border px-2 py-0.5 font-mono text-xs">
                {term}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t('termsNote')}
            {r.since ? ` ${t('since', { year: r.since })}` : ''}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('searchedIn')}{' '}
          {r.sources
            .filter((s) => s.searched)
            .map((s) => s.name)
            .join(', ') || t('nothingSearched')}
        </p>
        {working && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <span>{t('running')}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                stop.reset();
                setConfirmingStop(true);
              }}
              disabled={stop.isPending}
            >
              {stop.isPending ? t('stopping') : t('stop')}
            </Button>
            <ConfirmDialog
              open={confirmingStop}
              onOpenChange={setConfirmingStop}
              title={tConfirm('stopTitle')}
              text={tConfirm('stopText')}
              confirmLabel={tConfirm('stopYes')}
              pending={stop.isPending}
              error={stop.error}
              onConfirm={() => stop.mutate()}
            />
          </div>
        )}
        {r.error && (
          <p className="rounded-md bg-warning px-3 py-2 text-sm text-warning-foreground">
            {r.error}
          </p>
        )}
        {!confirmingStop && <ProblemMessage error={stop.error} />}
      </header>

      {r.links.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-lg font-semibold">{t('linksTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('linksNote')}</p>
          <ul className="flex flex-wrap gap-2">
            {r.links.map((link) => (
              <li key={link.sourceId}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  {link.name}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!working && (
        <section className="grid gap-2">
          <h2 className="text-lg font-semibold">{t('brief')}</h2>
          {r.brief ? (
            <>
              <p className="text-xs text-muted-foreground">{t('briefNote')}</p>
              <div className="grid gap-3 rounded-xl border p-4 text-sm leading-relaxed">
                {r.brief.split(/\n{2,}/).map((block, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    {withRefs(block, refs)}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noBrief')}</p>
          )}
        </section>
      )}

      <Results run={r} />

      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">{t('searchesTitle')}</h2>
        <p className="text-xs text-muted-foreground">{t('searchesNote')}</p>
        {r.searches.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noSearches')}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {r.searches.map((s, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{s.source}</span>
                <span className="font-mono text-xs">{s.query}</span>
                <span className="text-xs text-muted-foreground">
                  {t('found', { count: s.found })} · {formatDateTime(s.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Results({ run }: { run: ResearchRun }) {
  const t = useTranslations('research');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setChosen((all) => {
      const next = new Set(all);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('resultsTitle', { count: run.results.length })}</h2>
      {run.results.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {run.status === 'queued' || run.status === 'running' ? t('searching') : t('noResults')}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('resultsNote')}</p>
          <ol className="grid gap-2">
            {run.results.map((result) => (
              <ResultItem
                key={result.id}
                result={result}
                chosen={chosen.has(result.id)}
                onToggle={() => toggle(result.id)}
              />
            ))}
          </ol>
          <KeepForm run={run} chosen={[...chosen]} onKept={() => setChosen(new Set())} />
        </>
      )}
    </section>
  );
}

function ResultItem({
  result,
  chosen,
  onToggle,
}: {
  result: ResearchResult;
  chosen: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('research');
  const id = useId();
  const kept = !!result.keptAt;
  return (
    <li
      id={`result-${result.ref}`}
      className="flex gap-3 rounded-lg border p-3 text-sm target:ring-2"
    >
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-4 shrink-0"
        checked={kept || chosen}
        disabled={kept}
        onChange={onToggle}
        aria-label={t('choose', { title: result.title })}
      />
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="rounded bg-muted px-1 font-mono text-xs text-muted-foreground">
            {result.ref}
          </span>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline-offset-2 hover:underline"
          >
            {result.title}
          </a>
          {kept && <Pill tone="good">{t('kept')}</Pill>}
        </div>
        <p className="text-xs text-muted-foreground">
          {[
            t(`kinds.${result.kind}`),
            result.source.name,
            result.detail,
            result.year,
            result.externalId,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {result.snippet && <p className="line-clamp-4 text-sm">{result.snippet}</p>}
      </div>
    </li>
  );
}

function KeepForm({
  run,
  chosen,
  onKept,
}: {
  run: ResearchRun;
  chosen: string[];
  onKept: () => void;
}) {
  const t = useTranslations('research');
  const id = useId();
  const queryClient = useQueryClient();
  const me = useMe();
  const projects = useProjectOptions();
  const [projectId, setProjectId] = useState(run.project?.id ?? '');
  const [stepKey, setStepKey] = useState(run.stepKey ?? '');
  const route = useProjectRoute(projectId, !!projectId);
  const [done, setDone] = useState<{ count: number; step: string } | null>(null);
  const keep = useMutation({
    mutationFn: () =>
      api(keepResearch, {
        params: { id: run.id },
        body: {
          projectId,
          ...(stepKey && { stepKey }),
          results: chosen.map((resultId) => ({ resultId })),
        },
      }),
    onSuccess: (out) => {
      setDone({ count: out.items.length, step: stepKey });
      onKept();
      void queryClient.invalidateQueries({ queryKey: queryKeys.researchRun(run.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources(projectId) });
    },
  });

  return (
    <form
      className="grid gap-3 rounded-xl border bg-muted/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(null);
        keep.mutate();
      }}
    >
      <h3 className="font-medium">{t('keepTitle')}</h3>
      {!run.project && (
        <p className="text-sm text-muted-foreground">
          {t('keepNoProject')}{' '}
          {me.data?.role.key === 'vp' && (
            <Link href="/projects/new" className="font-medium underline-offset-2 hover:underline">
              {t('startProject')}
            </Link>
          )}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-project`}>{t('keepProject')}</Label>
          <select
            id={`${id}-project`}
            className={selectClass}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setStepKey('');
            }}
          >
            <option value="">{t('chooseProject')}</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-step`}>{t('keepStep')}</Label>
          <select
            id={`${id}-step`}
            className={selectClass}
            value={stepKey}
            disabled={!projectId}
            onChange={(e) => setStepKey(e.target.value)}
          >
            <option value="">{t('wholeProject')}</option>
            {(projectId ? (route.data?.steps ?? []) : []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.key} · {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ProblemMessage error={keep.error} />
      {done && (
        <p className="text-sm text-emerald-800">
          {done.step
            ? t('keptNoteStep', { count: done.count, step: done.step })
            : t('keptNote', { count: done.count })}
        </p>
      )}
      <div>
        <Button type="submit" disabled={chosen.length === 0 || !projectId || keep.isPending}>
          {keep.isPending ? t('keeping') : t('keep', { count: chosen.length })}
        </Button>
      </div>
    </form>
  );
}
