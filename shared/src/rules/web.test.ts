import { describe, expect, it } from 'vitest';
import { copiedPassage, figuresOf, siteOf, webBriefProblems } from './web';

const context = {
  private: ['SPN-26-001', 'Quokka cervical plate', 'Vera Example'],
  coal: JSON.stringify({
    result: {
      budget: '₹45,00,000',
      screw: 'The locking screw is 4.5 mm and the plate is 2.6 mm thick',
      code: 'CANARY-WOMBAT-7Q2',
      id: '01a21938-bfd8-736f-a4a1-cc6191da083c',
      dueOn: '2026-12-15',
      note: 'Material is 316L stainless steel to ISO 5832-1, tested to ASTM F1717 in 2025',
      summary: 'the design keeps a low profile over the anterior column of the cervical spine',
    },
  }),
  allowed: 'Is a plate of 2.6 mm thick normal?',
};

const brief = (question: string, lookFor: string[] = ['the typical range'], sites: string[] = []) =>
  webBriefProblems({ question, lookFor, sites }, context);

describe('a brief for the web assistant', () => {
  it('lets a general question through', () => {
    expect(
      brief('What does ASTM F1717 require for testing anterior cervical plates?', [
        'the static and fatigue tests, with their loads in N',
        'the edition of the standard',
      ]),
    ).toEqual([]);
  });

  it('refuses a project code, a project name, a person, the company and addresses', () => {
    expect(brief('Competitors to SPN-26-001 on the market?').join(' ')).toMatch(/project code/);
    expect(brief('Which cages compete with the quokka cervical plate?').join(' ')).toContain(
      'Quokka cervical plate',
    );
    expect(brief('Papers written by Vera Example on plates?').join(' ')).toContain('Vera Example');
    expect(brief('What does Jayon make for the spine?').join(' ')).toMatch(/names the company/);
    expect(brief('What is on https://example.org/plates today?').join(' ')).toMatch(/address/);
    expect(brief('Who wrote to someone@example.org about plates?').join(' ')).toMatch(/address/);
  });

  it("refuses a figure from COAL's records that the person never said", () => {
    expect(brief('Is a 4.5 mm locking screw usual for cervical plates?').join(' ')).toMatch(
      /4\.5, from COAL's records/,
    );
    expect(brief('Is a budget of 45,00,000 rupees normal for a plate?').join(' ')).toMatch(
      /4500000/,
    );
    expect(brief('Is a 4.5mm locking screw usual for cervical plates?')).not.toEqual([]);
  });

  it('lets a figure through that the person said, or that is not in the records', () => {
    expect(brief('Is a plate 2.6 mm thick usual for anterior cervical plates?')).toEqual([]);
    expect(brief('Is a 3.5 mm locking screw usual for cervical plates?')).toEqual([]);
  });

  it('does not count years, standards, public ids or designations as figures', () => {
    expect(figuresOf('ISO 5832-1 and ASTM F1717 and 21 CFR 820.30 since 2025')).toEqual([]);
    expect(figuresOf('EN ISO 13485:2016 and ISO/TS 10993-19')).toEqual([]);
    expect(figuresOf('K123456 and NCT01234567')).toEqual([]);
    expect(figuresOf('316L stainless steel and Ti-6Al-4V')).toEqual([]);
    expect(figuresOf('a 4.5 mm screw, 1,200 N, 4.50mm and 12 holes')).toEqual(['4.5', '1200']);
    expect(brief('What do 316L stainless steel plates to ISO 5832-1 weigh?')).toEqual([]);
  });

  it("refuses a code from COAL's records", () => {
    expect(brief('What is CANARY-WOMBAT-7Q2?').join(' ')).toMatch(/CANARY-WOMBAT-7Q2, a code/);
  });

  it("refuses eight words in a row copied from COAL's records", () => {
    expect(
      brief('Which plates keep a low profile over the anterior column of the cervical spine?').join(
        ' ',
      ),
    ).toMatch(/copies words/);
    expect(
      copiedPassage(
        'one two three four five six seven eight',
        'one two three four five six seven eight nine',
        '',
      ),
    ).toBe('one two three four five six seven eight');
    expect(
      copiedPassage(
        'one two three four five six seven eight',
        'one two three four five six seven eight',
        'one two three four five six seven eight',
      ),
    ).toBeNull();
  });

  it('keeps sites to public websites that are not the company', () => {
    expect(brief('What does the regulator say about plates?', ['guidance'], ['fda.gov'])).toEqual(
      [],
    );
    for (const site of [
      'localhost',
      'intranet.local',
      '10.0.0.1',
      'jayon.com',
      'quokka cervical plate',
    ]) {
      expect(brief('What does the regulator say about plates?', ['guidance'], [site])).not.toEqual(
        [],
      );
    }
  });

  it('names the site of an address', () => {
    expect(siteOf('https://www.fda.gov/medical-devices')).toBe('fda.gov');
    expect(siteOf('not an address')).toBe('');
  });
});
