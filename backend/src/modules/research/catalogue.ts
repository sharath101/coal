import type { ResearchSourceSettings } from '@coal/shared';

/**
 * The public places every library starts with (docs/workstation-and-ai.md#the-source-library).
 * The VP, the R&D Head and the R&D Leads add their own (journals, trade news) and can change or
 * switch off these. Loading them again adds only the ones missing, so a change is never undone.
 */
export const DEFAULT_RESEARCH_SOURCES: {
  key: string;
  name: string;
  note: string;
  settings: ResearchSourceSettings;
}[] = [
  {
    key: 'pubmed',
    name: 'PubMed',
    note: 'Published studies in medicine: clinical outcomes, complications and surgical techniques.',
    settings: { kind: 'pubmed' },
  },
  {
    key: 'europepmc',
    name: 'Europe PMC',
    note: 'Papers and preprints, including some PubMed does not hold. Good for full texts.',
    settings: { kind: 'europepmc' },
  },
  {
    key: 'clinicaltrials',
    name: 'ClinicalTrials.gov',
    note: 'Registered clinical studies worldwide: their design, size, follow-up and sponsor.',
    settings: { kind: 'clinicaltrials' },
  },
  {
    key: 'fda-510k',
    name: 'FDA 510(k) clearances',
    note: 'Devices cleared for the US market: who makes them, when, and their FDA product code and class. The best list of existing products.',
    settings: { kind: 'openfda', datasets: ['510k', 'classification'] },
  },
  {
    key: 'fda-gudid',
    name: 'FDA GUDID device list',
    note: 'Device identifiers on the US market: brands, models and sizes, by maker.',
    settings: { kind: 'openfda', datasets: ['udi'] },
  },
  {
    key: 'fda-maude',
    name: 'FDA MAUDE adverse events',
    note: 'Reports of device problems and harm to patients. Counts are not rates.',
    settings: { kind: 'openfda', datasets: ['event'] },
  },
  {
    key: 'fda-recalls',
    name: 'FDA recalls',
    note: 'Device recalls and their reasons.',
    settings: { kind: 'openfda', datasets: ['recall'] },
  },
  {
    key: 'ctri',
    name: 'CTRI (India)',
    note: 'Clinical Trials Registry of India. Its search is behind a declaration page, so you search it yourself.',
    settings: { kind: 'link', url: 'https://ctri.nic.in/' },
  },
  {
    key: 'google-scholar',
    name: 'Google Scholar',
    note: 'A broad search of papers, theses and books. Google allows no automated searching, so you open it.',
    settings: { kind: 'link', url: 'https://scholar.google.com/scholar?q={q}' },
  },
  {
    key: 'google-patents',
    name: 'Google Patents',
    note: 'Patents to check before and during design.',
    settings: { kind: 'link', url: 'https://patents.google.com/?q={q}' },
  },
  {
    key: 'espacenet',
    name: 'Espacenet',
    note: "The European Patent Office's patent search.",
    settings: { kind: 'link', url: 'https://worldwide.espacenet.com/patent/search?q={q}' },
  },
];
