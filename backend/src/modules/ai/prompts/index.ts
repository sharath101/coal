import { createHash } from 'node:crypto';
import type { RouteDefinition } from '@coal/shared';
import { COMPANY_FACTS, routeSummary } from './company';
import { PLATFORM_RULES } from './platform';
import { roleSummary } from './role';
import { OUTSIDE_TEXT_RULES, SAMPLE_RULES } from './template';
import { WRITING_RULES } from './writing';

/**
 * A short fingerprint of the fixed instructions: it changes whenever their text does, and is
 * logged with every model request, so a change in behaviour can be traced to a change in words.
 */
export const PROMPT_VERSION = `v1-${createHash('sha256')
  .update(PLATFORM_RULES + COMPANY_FACTS + WRITING_RULES + OUTSIDE_TEXT_RULES + SAMPLE_RULES)
  .digest('hex')
  .slice(0, 8)}`;

export interface InstructionInputs {
  /** Today in Indian time, as `2026-11-20`. */
  today: string;
  user: { name: string; roleKey: string; roleName: string; productLine: string | null };
  routes: RouteDefinition[];
  /** What the chat is pinned to, in words; empty lines are left out. */
  context: string[];
  /** The action cards of this chat that still wait for the person, in words. */
  cards: string[];
  /** A file from outside is in the chat: the rules for reading it, and for making a template from it. */
  hasFile?: boolean;
}

/** The layers of the AI's instructions, in order (docs/workstation-and-ai.md#how-the-ai-is-told-what-to-do). */
export function buildInstructions(i: InstructionInputs): string {
  const person = [
    `THE PERSON YOU ARE HELPING`,
    `Name: ${i.user.name}. Role: ${i.user.roleName}.${i.user.productLine ? ` Product line: ${i.user.productLine}.` : ''}`,
    `Today is ${i.today} (Indian time).`,
  ].join('\n');
  const pinned =
    i.context.length > 0
      ? `THIS CHAT IS ABOUT\n${i.context.join('\n')}\nUse your tools to look at these; ids are given so you need not search.`
      : '';
  const waiting =
    i.cards.length > 0
      ? `ACTION CARDS WAITING FOR THE PERSON\n${i.cards.join('\n')}\nIf the person asks to change one, use revise_card with its id.`
      : '';
  return [
    PLATFORM_RULES,
    COMPANY_FACTS,
    routeSummary(i.routes),
    roleSummary(i.user.roleKey, i.user.roleName, i.routes),
    person,
    pinned,
    waiting,
    WRITING_RULES,
    i.hasFile ? OUTSIDE_TEXT_RULES : '',
    i.hasFile ? SAMPLE_RULES : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
