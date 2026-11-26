'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * The heading over the items of one product line (P114). Items that belong to no project get a
 * heading of their own. `count` is left out where more items may still be loading.
 */
export function LineHeading({
  name,
  count,
  as: Tag = 'h4',
  className,
}: {
  name: string | null;
  count?: number | undefined;
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
}) {
  const t = useTranslations('lineGroup');
  return (
    <Tag
      className={cn(
        'text-xs font-semibold tracking-wide text-muted-foreground uppercase',
        className,
      )}
    >
      {name ?? t('none')}
      {count !== undefined && <span className="ml-1.5 font-normal">{count}</span>}
    </Tag>
  );
}
