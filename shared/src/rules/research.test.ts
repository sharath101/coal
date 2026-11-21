import { describe, expect, it } from 'vitest';
import { queryProblems, researchTermProblems, searchLink, siteSearchLink } from './research';

const context = { private: ['SPN-26-001', 'Quokka cervical plate', 'Vera Example'] };

describe('research terms', () => {
  it('lets general terms through', () => {
    expect(
      researchTermProblems(['expandable TLIF cage', 'PEEK', 'MAX', '3D printed titanium'], context),
    ).toEqual([]);
  });

  it('refuses a project code, a project name, a person, the company and addresses', () => {
    const refused = [
      'cage SPN-26-001',
      'ABC-25-012 plate',
      'quokka Cervical-Plate design',
      'vera example cage',
      'Jayon cage',
      'www.example.com',
    ];
    for (const term of refused) expect(researchTermProblems([term], context)).not.toEqual([]);
    const problems = researchTermProblems(refused, context).join(' ');
    expect(problems).toMatch(/project code/);
    expect(problems).toMatch(/names the company/);
    expect(problems).toMatch(/looks like an address/);
    expect(problems).toContain('Quokka cervical plate');
  });

  it('keeps each term short and the list small', () => {
    expect(
      researchTermProblems(['a long description of the cage we plan to make'], context),
    ).toEqual([expect.stringMatching(/too long/)]);
    expect(researchTermProblems(Array(9).fill('cage'), context)).toEqual([
      expect.stringMatching(/at most 8/),
    ]);
  });

  it('matches whole words only, so a general word inside a name is not refused', () => {
    expect(researchTermProblems(['cervical plate'], context)).toEqual([]);
  });
});

describe('queries sent outside', () => {
  const terms = ['expandable TLIF cage', 'subsidence'];

  it('may use the approved words, in any order, with AND, OR and NOT', () => {
    expect(queryProblems('(TLIF AND cage) OR "expandable cage" NOT subsidence', terms)).toEqual([]);
  });

  it('may not add a word the person did not approve', () => {
    expect(queryProblems('expandable cage quokka', terms)).toEqual([
      expect.stringContaining('quokka'),
    ]);
  });
});

describe('search links', () => {
  it('puts the terms where the address asks for them', () => {
    expect(
      searchLink('https://scholar.google.com/scholar?q={q}', ['expandable cage', 'PEEK']),
    ).toBe('https://scholar.google.com/scholar?q=expandable%20cage%20PEEK');
    expect(searchLink('https://ctri.nic.in/Clinicaltrials/advsearch.php', ['cage'])).toBe(
      'https://ctri.nic.in/Clinicaltrials/advsearch.php',
    );
    expect(siteSearchLink(['odtmag.com'], ['expandable cage'])).toBe(
      'https://www.google.com/search?q=site%3Aodtmag.com%20expandable%20cage',
    );
  });
});
