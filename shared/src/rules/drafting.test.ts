import { describe, expect, it } from 'vitest';
import { draftProblems, isWhatWasSaid, numbersOf, ungroundedNumbers } from './drafting';
import { TemplateSpec } from './templates';

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
    { id: 'purpose', kind: 'written', title: 'Purpose', instructions: 'State the need.' },
    { id: 'team', kind: 'fields', fields: { members: { from: 'project.team' } } },
  ],
});

describe('numbers in written text', () => {
  it('are read the same way whatever the commas', () => {
    expect(numbersOf('Costs 12,500 and 3.50 and 4.0')).toEqual(['12500', '3.50', '4']);
  });

  it('must come from a source, except single digits', () => {
    const sources = 'The plate is 2.4 mm thick. Budget 12,500. Step 5 opens on 27 Nov 2026.';
    expect(ungroundedNumbers('A 2.4 mm plate costing 12500 for 3 phases.', sources)).toEqual([]);
    expect(ungroundedNumbers('A 3.1 mm plate with a 450 MPa yield.', sources)).toEqual([
      '3.1',
      '450',
    ]);
  });
});

describe('what the person said', () => {
  it('matches by their words, not by an exact copy', () => {
    const said = 'We will sell in India, Nepal and Sri Lanka first.';
    expect(isWhatWasSaid('India, Nepal and Sri Lanka', said)).toBe(true);
    expect(isWhatWasSaid('Germany and France', said)).toBe(false);
    expect(isWhatWasSaid('UK', said)).toBe(true);
  });
});

describe('what the assistant may save into a draft', () => {
  const ground = { said: 'Target markets are India and Nepal.', read: 'Plate thickness 2.4 mm.' };

  it('accepts words and numbers that have a source', () => {
    expect(
      draftProblems(
        spec,
        {
          fields: { target_markets: 'India and Nepal' },
          sections: { purpose: 'Surgeons need a 2.4 mm plate.' },
        },
        ground,
      ),
    ).toEqual([]);
  });

  it('refuses a made-up number, a value the person did not give and a field COAL fills itself', () => {
    const problems = draftProblems(
      spec,
      {
        fields: { target_markets: 'Germany and Brazil', project_code: 'SPN-26-009' },
        sections: { purpose: 'A 450 MPa plate.' },
      },
      ground,
    );
    expect(problems).toEqual([
      '"Purpose" states 450, which no source gave. Take it out, or ask the person for it.',
      '"target_markets" must be what the person told you, in their words. Ask them for it instead of writing it yourself.',
      "{project_code} is filled from COAL's records, so it cannot be set here.",
    ]);
  });
});
