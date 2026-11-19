'use client';

import { TASK_KINDS } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { selectClass } from '@/components/role-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useProductLines,
  useProjectOptions,
  type WidgetFilter,
  type WidgetInfo,
} from '@/lib/queries';

export type Filters = Partial<Record<WidgetFilter, string>>;

const DUE = ['overdue', 'week', 'later', 'none'] as const;
const STAGES = ['1', '2', '3', '4', '5', '6'] as const;
const HEALTH = ['green', 'amber', 'red'] as const;

/** The filters a widget offers, as small selects and a text box. A change goes to the URL. */
export function WidgetFilters({
  info,
  filters,
  onChange,
}: {
  info: WidgetInfo;
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  const t = useTranslations('widgets');
  const tTask = useTranslations('tasks');
  const tHealth = useTranslations('health');
  const projects = useProjectOptions();
  const lines = useProductLines();
  if (info.filters.length === 0) return null;

  const set = (name: WidgetFilter, value: string) => {
    const next = { ...filters };
    if (value) next[name] = value;
    else delete next[name];
    onChange(next);
  };
  const anyFilter = info.filters.some((f) => filters[f as WidgetFilter]);

  const select = (name: WidgetFilter, all: string, options: { value: string; label: string }[]) => (
    <div className="grid gap-1" key={name}>
      <Label htmlFor={`filter-${name}`} className="text-xs text-muted-foreground">
        {t(`filters.${name}`)}
      </Label>
      <select
        id={`filter-${name}`}
        className={selectClass}
        value={filters[name] ?? ''}
        onChange={(e) => set(name, e.target.value)}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  const control = (name: string) => {
    switch (name as WidgetFilter) {
      case 'project':
        return select(
          'project',
          t('filters.allProjects'),
          (projects.data ?? []).map((p) => ({ value: p.code, label: `${p.code} · ${p.name}` })),
        );
      case 'step':
        return (
          <div className="grid gap-1" key="step">
            <Label htmlFor="filter-step" className="text-xs text-muted-foreground">
              {t('filters.step')}
            </Label>
            {/* Typing is applied when the box loses focus or Enter is pressed. */}
            <Input
              id="filter-step"
              key={filters.step ?? ''}
              defaultValue={filters.step ?? ''}
              maxLength={10}
              placeholder={t('filters.stepHint')}
              onBlur={(e) =>
                e.target.value.trim() !== (filters.step ?? '') && set('step', e.target.value.trim())
              }
              onKeyDown={(e) => e.key === 'Enter' && set('step', e.currentTarget.value.trim())}
            />
          </div>
        );
      case 'kind':
        return select(
          'kind',
          t('filters.allKinds'),
          TASK_KINDS.map((k) => ({ value: k, label: tTask(`kind.${k}`) })),
        );
      case 'due':
        return select(
          'due',
          t('filters.anyDue'),
          DUE.map((d) => ({ value: d, label: t(`filters.dueOptions.${d}`) })),
        );
      case 'line':
        return select(
          'line',
          t('filters.allLines'),
          (lines.data ?? []).map((l) => ({ value: l.code, label: l.name })),
        );
      case 'stage':
        return select(
          'stage',
          t('filters.allStages'),
          STAGES.map((s) => ({ value: s, label: t('stageOf', { stage: Number(s) }) })),
        );
      case 'health':
        return select(
          'health',
          t('filters.anyHealth'),
          HEALTH.map((h) => ({ value: h, label: tHealth(h) })),
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t('filters.heading')}>
      {info.filters.map((name) => (
        <div key={name} className="w-40">
          {control(name)}
        </div>
      ))}
      {anyFilter && (
        <Button size="sm" variant="ghost" onClick={() => onChange({})}>
          {t('filters.clear')}
        </Button>
      )}
    </div>
  );
}
