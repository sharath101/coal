'use client';

import type { Preview } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { PreviewPanel } from '@/components/preview-panel';
import { SigningNotice } from '@/components/signing-preview';
import { Button } from '@/components/ui/button';

/**
 * The yes-or-no after a workflow action's preview: what it says it will do (the steps that move,
 * the tasks and who gets them, the warnings) and a button that does it. The action is not run
 * until the person presses it. `signs`: the click is a signature, so the placeholder notice shows.
 */
export function ActionConfirm({
  title,
  text,
  confirmLabel,
  preview,
  signs = false,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  preview: Preview;
  signs?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Anything else worth reading before the yes, such as the documents handed in. */
  children?: ReactNode;
}) {
  const t = useTranslations('confirm');
  const id = useId();
  return (
    <section
      role="group"
      aria-labelledby={id}
      className="grid gap-3 rounded-lg border bg-background p-3 text-sm"
    >
      <h4 id={id} className="font-medium">
        {title}
      </h4>
      <p className="text-muted-foreground">{text}</p>
      {children}
      {signs && <SigningNotice />}
      <PreviewPanel preview={preview} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </section>
  );
}
