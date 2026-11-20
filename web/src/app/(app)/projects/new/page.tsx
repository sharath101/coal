'use client';

import { createProject, type EndpointOutput } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { PreviewPanel } from '@/components/preview-panel';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/role-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { queryKeys, useMe, usePeople, useProductLines } from '@/lib/queries';

type GoResult = EndpointOutput<typeof createProject>;

export default function NewProjectPage() {
  return (
    <Suspense fallback={null}>
      <NewProject />
    </Suspense>
  );
}

/**
 * Go: the VP turns a concept into a project. Preview first, then create (docs/workflow.md#decisions-recorded-at-steps).
 * An idea the assistant worked out in the Workstation arrives filled in, from the address, to review.
 */
function NewProject() {
  const t = useTranslations('newProject');
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const productLines = useProductLines();
  const people = usePeople();
  const [name, setName] = useState(() => params.get('name') ?? '');
  const [description, setDescription] = useState(() => params.get('description') ?? '');
  const [productLineId, setProductLineId] = useState(() => params.get('productLineId') ?? '');
  const [team, setTeam] = useState<string[]>(
    () => params.get('team')?.split(',').filter(Boolean) ?? [],
  );
  const [preview, setPreview] = useState<GoResult | null>(null);

  const body = { name, description, productLineId, teamUserIds: team };
  const previewMutation = useMutation({
    mutationFn: () => api(createProject, { query: { preview: 'true' }, body }),
    onSuccess: (res) => setPreview(res),
  });
  const create = useMutation({
    mutationFn: () => api(createProject, { body }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      router.push(`/projects/${res.project?.id}`);
    },
  });

  if (!me) return null;
  if (me.role.key !== 'vp') {
    return <p className="p-6 text-sm text-muted-foreground">{t('onlyVp')}</p>;
  }

  const changed = () => setPreview(null);
  const toggle = (id: string) => {
    setTeam((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    changed();
  };
  const ready = name.trim().length >= 3 && productLineId !== '';

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (preview) create.mutate();
          else previewMutation.mutate();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="name">{t('name')}</Label>
          <Input
            id="name"
            required
            minLength={3}
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              changed();
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">{t('description')}</Label>
          <Textarea
            id="description"
            maxLength={2000}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              changed();
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="product-line">{t('productLine')}</Label>
          <select
            id="product-line"
            required
            className={selectClass}
            value={productLineId}
            onChange={(e) => {
              setProductLineId(e.target.value);
              changed();
            }}
          >
            <option value="" disabled>
              {t('chooseProductLine')}
            </option>
            {(productLines.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t('team')}</legend>
          <p className="text-sm text-muted-foreground">{t('teamHint')}</p>
          <ul className="grid max-h-56 gap-1 overflow-auto rounded-md border p-3 text-sm">
            {(people.data ?? [])
              .filter((p) => p.status === 'active')
              .map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={team.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">· {p.role.name}</span>
                  </label>
                </li>
              ))}
          </ul>
        </fieldset>

        {preview && (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">{t('previewDone')}</p>
            <PreviewPanel preview={preview.preview} showTeam />
          </div>
        )}

        <ProblemMessage error={previewMutation.error ?? create.error ?? people.error} />
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={!ready || previewMutation.isPending || create.isPending}
            variant={preview ? 'default' : 'outline'}
          >
            {preview
              ? create.isPending
                ? t('creating')
                : t('create')
              : previewMutation.isPending
                ? t('previewing')
                : t('preview')}
          </Button>
        </div>
      </form>
    </div>
  );
}
