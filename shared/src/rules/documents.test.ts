import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  diffText,
  formatDocumentNumber,
  missingRequired,
  revisionLabel,
} from './documents';
import { TemplateSpec, checkPlaceholders, specPlaceholders } from './templates';

const spec = TemplateSpec.parse({
  template: 'Project Initiation Document',
  document_type: 'PID',
  steps: ['1'],
  sections: [
    {
      id: 'header',
      kind: 'fields',
      fields: {
        project_code: { from: 'project.code' },
        target_markets: { from: 'person', required: true },
      },
    },
    { id: 'purpose', kind: 'written', instructions: 'State the need.', required: true },
    { id: 'team', kind: 'fields', fields: { members: { from: 'project.team' } } },
  ],
  signature_rows: ['prepared', 'reviewed', 'approved'],
  reviewed_by: ['dard'],
});

describe('template specification', () => {
  it('lists every placeholder the Word file must use', () => {
    expect(specPlaceholders(spec)).toEqual([
      { name: 'project_code', kind: 'text' },
      { name: 'target_markets', kind: 'text' },
      { name: 'purpose', kind: 'written' },
      { name: 'members', kind: 'table' },
    ]);
  });

  it('refuses a name used twice, a Reviewed row nobody signs, and unknown keys', () => {
    const base = { template: 'Plan', document_type: 'PLAN', steps: ['5'] };
    const field = { from: 'person' };
    expect(
      TemplateSpec.safeParse({
        ...base,
        sections: [
          { id: 'a', kind: 'fields', fields: { x: field } },
          { id: 'b', kind: 'fields', fields: { x: field } },
        ],
      }).success,
    ).toBe(false);
    expect(
      TemplateSpec.safeParse({
        ...base,
        sections: [{ id: 'a', kind: 'fields', fields: { x: field } }],
        signature_rows: ['prepared', 'reviewed', 'approved'],
      }).success,
    ).toBe(false);
    expect(
      TemplateSpec.safeParse({
        ...base,
        sections: [{ id: 'a', kind: 'fields', fields: { x: { from: 'the moon' } } }],
      }).success,
    ).toBe(false);
  });
});

describe('placeholder check', () => {
  const good = {
    project_code: {},
    target_markets: {},
    purpose: {},
    members: { name: {}, role: {} },
  };

  it('passes when the Word file and the specification agree', () => {
    expect(checkPlaceholders(spec, good).problems).toEqual([]);
  });

  it('names what to change, both ways', () => {
    const { problems } = checkPlaceholders(spec, {
      project_code: {},
      purpose: {},
      stray: {},
      members: { name: {}, email: {} },
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('{stray}'),
        expect.stringContaining('"target_markets"'),
        expect.stringContaining('{email}'),
      ]),
    );
  });

  it('wants a table written as a loop, and a single value written plainly', () => {
    const { problems } = checkPlaceholders(spec, { ...good, members: {}, purpose: { x: {} } });
    expect(problems.some((p) => p.includes('{#members}'))).toBe(true);
    expect(problems.some((p) => p.includes('single value'))).toBe(true);
  });
});

describe('documents', () => {
  it('hashes the same content the same way, whatever the key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(
      canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }),
    );
  });

  it('gives revision letters A, B, … Z, AA', () => {
    expect([0, 1, 25, 26, 27].map(revisionLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });

  it('numbers a document from its pattern', () => {
    expect(
      formatDocumentNumber('{project_code}-{type}-{nn}', {
        projectCode: 'SPN-26-001',
        type: 'PID',
        nn: 3,
      }),
    ).toBe('SPN-26-001-PID-03');
  });

  it('lists what is still empty at submission', () => {
    expect(missingRequired(spec, { fields: { project_code: 'X' }, sections: {} })).toEqual([
      'Target markets',
      'Purpose',
    ]);
    expect(
      missingRequired(spec, {
        fields: { target_markets: 'India' },
        sections: { purpose: 'Need.' },
      }),
    ).toEqual([]);
  });

  it('compares text word by word', () => {
    expect(
      diffText('The knee implant is sterile.', 'The hip implant is sterile and sealed.'),
    ).toEqual([
      { type: 'same', text: 'The ' },
      { type: 'removed', text: 'knee' },
      { type: 'added', text: 'hip' },
      { type: 'same', text: ' implant is ' },
      { type: 'removed', text: 'sterile.' },
      { type: 'added', text: 'sterile and sealed.' },
    ]);
    expect(diffText('same', 'same')).toEqual([{ type: 'same', text: 'same' }]);
    expect(diffText('', 'new')).toEqual([{ type: 'added', text: 'new' }]);
  });
});
