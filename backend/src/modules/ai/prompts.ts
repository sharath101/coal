import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import type { AppDeps } from '../../core/deps';
import type { Actor } from '../../core/http/context';
import { ROLES } from '../org/catalogue';
import { listLatestVersions } from '../process/service';

/**
 * The assistant's instructions, in layers (docs/workstation-and-ai.md#how-the-ai-is-told-what-to-do):
 * platform rules and the company's processes first (stable, so they're cached), then the person
 * and their context (small, after the cache breakpoint).
 */

const PLATFORM = readFileSync(new URL('./prompts/assistant.md', import.meta.url), 'utf8');

const ROLE_NAMES = new Map(ROLES.map((r) => [r.key, r.name]));
export const roleLabel = (key: string) =>
  key === 'team' ? 'project team' : (ROLE_NAMES.get(key) ?? key);

let companyCache: string | null = null;

/** Each process's steps in one line each: who does it, who signs it, what it produces. */
export async function companyLayer(deps: AppDeps, orgId: string): Promise<string> {
  if (companyCache) return companyCache;
  const versions = await listLatestVersions(deps.db, orgId);
  const lines: string[] = ['# Jayon’s processes', ''];
  for (const v of versions) {
    lines.push(`## ${v.route.name} (process key \`${v.route.process}\`, version ${v.version})`, '');
    for (const stage of v.route.stages) {
      lines.push(`Stage ${stage.no}: ${stage.name}`);
      for (const step of v.route.steps.filter((s) => s.stage === stage.no)) {
        const doers = step.doers.map(roleLabel).join(', ');
        const signer = step.signer ? `signed by ${roleLabel(step.signer)}` : 'no sign-off';
        const flags = step.checkpoint ? ' (checkpoint)' : '';
        lines.push(
          `- Step ${step.key} · ${step.name}${flags}: done by ${doers}; ${signer}; produces ${step.outputs.join('; ') || 'nothing'}`,
        );
      }
      lines.push('');
    }
  }
  lines.push('# Roles', '', ROLES.map((r) => `- ${r.name} (\`${r.key}\`)`).join('\n'));
  companyCache = lines.join('\n');
  return companyCache;
}

export interface PersonContext {
  actor: Actor;
  pinnedProject: { id: string; code: string; name: string } | null;
}

export async function systemPrompt(
  deps: AppDeps,
  orgId: string,
  person: PersonContext,
): Promise<Anthropic.Beta.BetaTextBlockParam[]> {
  const today = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const who = [
    `# The person you're helping`,
    '',
    `${person.actor.name}, ${roleLabel(person.actor.roleKey)} (role key \`${person.actor.roleKey}\`). Their user id is ${person.actor.userId}.`,
    `Today is ${today} (India time).`,
    person.pinnedProject
      ? `This chat is about project ${person.pinnedProject.code} · ${person.pinnedProject.name} (id ${person.pinnedProject.id}).`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { type: 'text', text: PLATFORM },
    { type: 'text', text: await companyLayer(deps, orgId), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: who },
  ];
}
