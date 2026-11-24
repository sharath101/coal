import { cn } from '@/lib/utils';

/** The look of a plain `<select>` everywhere in the website. */
export const selectClass = cn(
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
);
