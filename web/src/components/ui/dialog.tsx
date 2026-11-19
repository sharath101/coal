'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

/**
 * `dialog` is a centred box. `panel` is a large panel over the page on a computer and the whole
 * screen on a phone (docs/dashboard.md#widgets).
 */
function DialogContent({
  className,
  size = 'dialog',
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { size?: 'dialog' | 'panel' }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed z-50 bg-background shadow-lg outline-none',
          size === 'dialog' &&
            'top-1/2 left-1/2 grid max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 content-start gap-4 overflow-y-auto rounded-xl border p-5',
          size === 'panel' &&
            'inset-0 flex flex-col md:inset-4 md:rounded-xl md:border lg:inset-x-[5%] lg:inset-y-6',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger };
