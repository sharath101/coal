import { AI_INTENTS, ENDPOINTS } from '@coal/shared';
import { describe, expect, it } from 'vitest';
import { isViaAi, VIA_AI_SECRET } from '../../core/http/internal';
import { costUsd, listPurposes, purposeFor, PURPOSES, resolvePurpose } from './models';
import { tools } from './tools';

describe('the model table', () => {
  it('sends every kind of message to a row, and escalates complex ones', () => {
    for (const intent of AI_INTENTS) expect(PURPOSES[purposeFor(intent, false)]).toBeDefined();
    expect(purposeFor('lookup', false)).toBe('lookup');
    expect(purposeFor('lookup', true)).toBe('analysis');
    expect(purposeFor('analysis', true)).toBe('deep');
  });

  it('uses the cheapest model for routing and the strongest for writing documents', () => {
    expect(PURPOSES.route.model).toBe('claude-haiku-5-5');
    expect(PURPOSES.draft_write.model).toBe('claude-opus-5-5');
    expect(PURPOSES.explain.model).toBe('claude-opus-5-5');
  });

  it('lets configuration override a row, but only with a known model', () => {
    expect(resolvePurpose('draft_write', { draft_write: 'claude-sonnet-5-5' }).model).toBe(
      'claude-sonnet-5-5',
    );
    expect(resolvePurpose('draft_write', { draft_write: 'made-up-model' }).model).toBe(
      'claude-opus-5-5',
    );
    expect(listPurposes({}).find((p) => p.key === 'chat')?.modelName).toBe('Haiku 5.5');
  });

  it('prices a call from its tokens, counting cache reads and writes', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(costUsd('claude-haiku-5-5', usage)).toBe(0.6);
    expect(costUsd('claude-sonnet-5-5', usage)).toBe(12);
    expect(costUsd('claude-opus-5-5', usage)).toBe(24);
    expect(
      costUsd('claude-opus-5-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
      }),
    ).toBe(0.2 + 5);
  });
});

describe('the tools', () => {
  const names = tools().map((t) => ('name' in t ? t.name : ''));

  it('never offers a never-tier endpoint, and offers confirm-tier ones only as cards', () => {
    for (const e of ENDPOINTS) {
      const name = e.id.replace(/\./g, '_');
      if (e.aiTier === 'never' || e.aiTier === 'none') {
        expect(names).not.toContain(name);
        expect(names).not.toContain(`propose_${name}`);
      }
      if (e.aiTier === 'confirm') {
        expect(names).not.toContain(name);
        expect(names).toContain(`propose_${name}`);
      }
    }
    expect(names).not.toContain('projects_create');
    expect(names).not.toContain('steps_approve');
  });
});

describe('the via-AI mark', () => {
  it('is set only by the backend’s own secret', () => {
    expect(isViaAi(VIA_AI_SECRET)).toBe(true);
    expect(isViaAi('true')).toBe(false);
    expect(isViaAi(undefined)).toBe(false);
    expect(isViaAi('x'.repeat(VIA_AI_SECRET.length))).toBe(false);
  });
});
