'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { workstationHref, type Pin } from '@/lib/workstation';

/** "Ask AI" / "Open in Workstation": a link that starts a chat about the thing it sits on. */
export function AskAiLink({ pin, label }: { pin: Pin; label?: string }) {
  const t = useTranslations('workstation');
  return (
    <Button asChild size="xs" variant="outline">
      <Link href={workstationHref(pin)}>
        <Sparkles aria-hidden />
        {label ?? t('ask')}
      </Link>
    </Button>
  );
}
