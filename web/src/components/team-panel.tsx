'use client';

import { putTeam, type ProjectDetail } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { usePeople } from '@/lib/queries';

/** The team, and for the Lead or the Head, a way to change it. Every change is recorded. */
export function TeamPanel({
  project,
  onChanged,
}: {
  project: ProjectDetail;
  onChanged: () => void;
}) {
  const t = useTranslations('project');
  const people = usePeople();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: () => api(putTeam, { params: { id: project.id }, body: { userIds: selected } }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {t('team')}
        </h2>
        {project.can.editTeam && !editing && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setSelected(project.team.map((m) => m.user.id));
              setEditing(true);
            }}
          >
            {t('editTeam')}
          </Button>
        )}
      </div>

      {!editing &&
        (project.team.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noTeam')}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {project.team.map((m) => (
              <li key={m.user.id}>
                <span className="font-medium">{m.user.name}</span>{' '}
                <span className="text-muted-foreground">· {m.user.role.name}</span>
              </li>
            ))}
          </ul>
        ))}

      {editing && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <ul className="grid max-h-64 gap-1 overflow-auto text-sm">
            {(people.data ?? [])
              .filter((p) => p.status === 'active')
              .map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">· {p.role.name}</span>
                  </label>
                </li>
              ))}
          </ul>
          <ProblemMessage error={mutation.error ?? people.error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={mutation.isPending || selected.length === 0}>
              {t('saveTeam')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
