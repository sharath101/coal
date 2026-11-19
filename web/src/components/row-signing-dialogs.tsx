'use client';

import { returnRequest, signRequest, type SigningPreview } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { SigningNotice, SigningPreviewPanel } from '@/components/signing-preview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useRefreshWork } from '@/lib/queries';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  /** What is being signed, for the heading. */
  title: string;
  /** The document's page, to read it first. */
  link: string | null;
  /** Which row it is: prepared, reviewed or approved. */
  meaning: string;
}

const MEANINGS = ['prepared', 'reviewed', 'approved', 'decision'] as const;
type Meaning = (typeof MEANINGS)[number];
const asMeaning = (value: string): Meaning => MEANINGS.find((m) => m === value) ?? 'approved';

/** Sign from a widget row: the same preview and confirm as on the document page. */
export function SignRequestDialog({ open, onOpenChange, requestId, title, link, meaning }: Props) {
  const t = useTranslations('signing');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">{t('signHeading')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{title}</DialogDescription>
        <SignBody
          requestId={requestId}
          link={link}
          meaning={asMeaning(meaning)}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function SignBody({
  requestId,
  link,
  meaning,
  onClose,
}: {
  requestId: string;
  link: string | null;
  meaning: Meaning;
  onClose: () => void;
}) {
  const t = useTranslations('signing');
  const tMeaning = useTranslations('meaning');
  const refresh = useRefreshWork();
  const [preview, setPreview] = useState<SigningPreview | null>(null);
  const previewSign = useMutation({
    mutationFn: () => api(signRequest, { params: { id: requestId }, query: { preview: 'true' } }),
    onSuccess: (result) => setPreview(result.preview),
  });
  const sign = useMutation({
    mutationFn: () => api(signRequest, { params: { id: requestId } }),
    onSuccess: () => {
      void refresh();
      onClose();
    },
  });
  const { mutate: loadPreview } = previewSign;
  useEffect(() => loadPreview(), [loadPreview]);

  return (
    <div className="grid gap-3 text-sm">
      <SigningNotice />
      {link && (
        <Link href={link} className="underline underline-offset-2">
          {t('readFirst')}
        </Link>
      )}
      {preview ? (
        <>
          <p>{t('confirmSignText', { meaning: tMeaning(meaning) })}</p>
          <SigningPreviewPanel preview={preview} />
        </>
      ) : (
        !previewSign.error && <p className="text-muted-foreground">{t('checking')}</p>
      )}
      <ProblemMessage error={previewSign.error ?? sign.error} />
      <div className="flex gap-2">
        <Button disabled={!preview || sign.isPending} onClick={() => sign.mutate()}>
          {t('confirmSign', { meaning: tMeaning(meaning) })}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Return a document to its authors from a widget row, with a comment. */
export function ReturnRequestDialog({
  open,
  onOpenChange,
  requestId,
  title,
}: Pick<Props, 'open' | 'onOpenChange' | 'requestId' | 'title'>) {
  const t = useTranslations('signing');
  const refresh = useRefreshWork();
  const [comment, setComment] = useState('');
  const giveBack = useMutation({
    mutationFn: () => api(returnRequest, { params: { id: requestId }, body: { comment } }),
    onSuccess: () => {
      void refresh();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">{t('return')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{title}</DialogDescription>
        <form
          className="grid gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            giveBack.mutate();
          }}
        >
          <Label htmlFor={`return-${requestId}`}>{t('returnComment')}</Label>
          <Textarea
            id={`return-${requestId}`}
            required
            minLength={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <ProblemMessage error={giveBack.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={giveBack.isPending || comment.trim().length < 3}>
              {t('confirmReturn')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
