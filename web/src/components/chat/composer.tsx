'use client';

import { SendHorizontal, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { useSearch } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * `/` commands: each starts a message the person finishes, or, for /brief, sends it at once
 * (docs/workstation-and-ai.md#the-five-things-the-ai-does). /idea and /draft come with drafting.
 */
const COMMANDS = [
  { key: 'status', send: false },
  { key: 'assign', send: false },
  { key: 'brief', send: true },
] as const;

const MENTION = /(?:^|\s)@([^\s@]{0,40})$/;
/** The records an @ can find, in the order they are listed: people first, documents last. */
const MENTIONABLE = ['person', 'project', 'document'];

/** What goes into the message for a found record: its code, number or name. */
const mentionText = (title: string) => title.split(' · ')[0] ?? title;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  replying: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** The message box: Enter sends, `/` lists commands, `@` finds people, projects and documents. */
export function Composer({ value, onChange, onSend, onStop, replying, inputRef }: Props) {
  const t = useTranslations('workstation');
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState('');

  const slash = value.startsWith('/') && !value.includes(' ') ? value.slice(1).toLowerCase() : null;
  const commands = slash === null ? [] : COMMANDS.filter((c) => c.key.startsWith(slash));
  const mention = MENTION.exec(value.slice(0, caret));
  const found = useSearch(mention && mention[1] && mention[1].length >= 2 ? mention[1] : '');
  const records = mention
    ? (found.data ?? [])
        .filter((r) => MENTIONABLE.includes(r.type))
        .sort((a, b) => MENTIONABLE.indexOf(a.type) - MENTIONABLE.indexOf(b.type))
        .slice(0, 6)
    : [];
  const menu: 'commands' | 'records' | null =
    dismissed === value
      ? null
      : commands.length > 0
        ? 'commands'
        : records.length > 0
          ? 'records'
          : null;
  const count = menu === 'commands' ? commands.length : records.length;

  const focus = () => requestAnimationFrame(() => inputRef.current?.focus());
  const pickCommand = (index: number) => {
    const command = commands[index];
    if (!command) return;
    const text = t(`commands.${command.key}.text`);
    if (command.send) {
      onChange('');
      onSend(text);
    } else {
      onChange(text);
      setCaret(text.length);
      focus();
    }
  };
  const pickRecord = (index: number) => {
    const record = records[index];
    if (!record || !mention) return;
    const before = value
      .slice(0, caret)
      .replace(MENTION, (all) => `${all.startsWith('@') ? '' : all[0]}`);
    const text = `${before}${mentionText(record.title)} ${value.slice(caret)}`;
    onChange(text);
    setCaret(before.length + mentionText(record.title).length + 1);
    focus();
  };
  const submit = () => {
    const text = value.trim();
    if (!text || replying) return;
    onChange('');
    onSend(text);
  };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && count > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (menu === 'commands') pickCommand(active);
        else pickRecord(active);
        setActive(0);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(value);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative">
      {menu && (
        <ul
          role="listbox"
          aria-label={t(menu === 'commands' ? 'commands.title' : 'mention.title')}
          className="absolute right-0 bottom-full left-0 z-10 mb-1 grid gap-0.5 rounded-lg border bg-popover p-1 text-sm shadow-md"
        >
          {menu === 'commands'
            ? commands.map((c, i) => (
                <li key={c.key} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left',
                      i === active ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickCommand(i);
                    }}
                  >
                    <span className="font-mono">/{c.key}</span>
                    <span className="text-muted-foreground">{t(`commands.${c.key}.help`)}</span>
                  </button>
                </li>
              ))
            : records.map((r, i) => (
                <li key={`${r.type}-${r.id}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left',
                      i === active ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickRecord(i);
                    }}
                  >
                    <span className="truncate">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(`mention.types.${r.type}`)}
                    </span>
                  </button>
                </li>
              ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={value}
          rows={1}
          maxLength={4000}
          placeholder={t('composer.placeholder')}
          aria-label={t('composer.label')}
          className="max-h-40 min-h-9 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart);
            setActive(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={keys}
        />
        {replying ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onStop}
            title={t('composer.stop')}
          >
            <Square aria-hidden />
            <span className="sr-only">{t('composer.stop')}</span>
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            disabled={!value.trim()}
            onClick={submit}
            title={t('composer.send')}
          >
            <SendHorizontal aria-hidden />
            <span className="sr-only">{t('composer.send')}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
