import type { ResearchResultKind, ResearchSourceSettings } from '@coal/shared';
import { type OutsideClient, asArray, asObject, asText, cut, plainOf } from './client';

/** One thing a source found, as COAL stores it. The address is built from the source's own id. */
export interface Found {
  kind: ResearchResultKind;
  externalId: string;
  title: string;
  detail: string;
  year: string | null;
  url: string;
  snippet: string;
}

export interface SearchArgs {
  query: string;
  since: number | null;
  limit: number;
  signal: AbortSignal;
}

const SNIPPET = 600;
const READ = 4000;

/** The words of a query without the operators, for sources that can't combine words. */
const plainWords = (query: string) =>
  query
    .replace(/[()"]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(AND|OR|NOT)$/i.test(w));

/** The year in a source's date: `2024 Mar`, `2025-02-03`, or openFDA's `20261029`. */
export const yearOf = (text: string): string | null =>
  /^((?:19|20)\d{2})\d{4}$/.exec(text.trim())?.[1] ?? /\b(19|20)\d{2}\b/.exec(text)?.[0] ?? null;

// PubMed (NCBI E-utilities), also for journals PubMed holds

function ncbi(client: OutsideClient, path: string, params: Record<string, string>): URL {
  const url = new URL(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('tool', 'coal');
  if (client.options.contactEmail) url.searchParams.set('email', client.options.contactEmail);
  if (client.options.ncbiApiKey) url.searchParams.set('api_key', client.options.ncbiApiKey);
  return url;
}

/** The abstracts of some PubMed articles, by id, from one efetch. */
async function pubmedAbstracts(
  client: OutsideClient,
  ids: string[],
  signal: AbortSignal,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const xml = await client.text(
    ncbi(client, 'efetch.fcgi', { db: 'pubmed', id: ids.join(','), retmode: 'xml' }),
    signal,
  );
  const out = new Map<string, string>();
  for (const article of xml.split(/<PubmedArticle>/).slice(1)) {
    const id = /<PMID[^>]*>(\d+)<\/PMID>/.exec(article)?.[1];
    if (!id) continue;
    const parts = [...article.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map(
      (m) => {
        const label = /Label="([^"]+)"/.exec(m[1] ?? '')?.[1];
        const text = plainOf(m[2] ?? '');
        return label ? `${label}: ${text}` : text;
      },
    );
    out.set(id, parts.join(' '));
  }
  return out;
}

async function searchPubmed(
  client: OutsideClient,
  args: SearchArgs,
  journal: string | null,
): Promise<Found[]> {
  const term = journal ? `(${args.query}) AND "${journal}"[Journal]` : args.query;
  const search = asObject(
    asObject(
      await client.json(
        ncbi(client, 'esearch.fcgi', {
          db: 'pubmed',
          term,
          retmax: String(args.limit),
          sort: 'relevance',
          retmode: 'json',
          ...(args.since && { datetype: 'pdat', mindate: String(args.since), maxdate: '3000' }),
        }),
        args.signal,
      ),
    ).esearchresult,
  );
  const ids = asArray(search.idlist).map(asText).filter(Boolean);
  if (ids.length === 0) return [];
  const summary = asObject(
    asObject(
      await client.json(
        ncbi(client, 'esummary.fcgi', { db: 'pubmed', id: ids.join(','), retmode: 'json' }),
        args.signal,
      ),
    ).result,
  );
  const abstracts = await pubmedAbstracts(client, ids, args.signal);
  return ids.flatMap((id): Found[] => {
    const item = asObject(summary[id]);
    const title = asText(item.title);
    if (!title) return [];
    const authors = asArray(item.authors).map((a) => asText(asObject(a).name));
    const who =
      authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ');
    return [
      {
        kind: 'article',
        externalId: `PMID ${id}`,
        title: cut(title, 300),
        detail: [who, asText(item.source)].filter(Boolean).join(' · '),
        year: yearOf(asText(item.pubdate)),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        snippet: cut(abstracts.get(id) ?? '', SNIPPET),
      },
    ];
  });
}

// Europe PMC

async function searchEuropePmc(client: OutsideClient, args: SearchArgs): Promise<Found[]> {
  const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  url.searchParams.set(
    'query',
    args.since ? `(${args.query}) AND PUB_YEAR:[${args.since} TO 3000]` : args.query,
  );
  url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core');
  url.searchParams.set('pageSize', String(args.limit));
  const list = asArray(asObject(asObject(await client.json(url, args.signal)).resultList).result);
  return list.flatMap((raw): Found[] => {
    const r = asObject(raw);
    const id = asText(r.id);
    const source = asText(r.source);
    const title = plainOf(asText(r.title));
    if (!id || !source || !title) return [];
    const journal =
      asText(asObject(asObject(r.journalInfo).journal).title) || asText(r.journalTitle);
    return [
      {
        kind: 'article',
        externalId: `${source} ${id}`,
        title: cut(title, 300),
        detail: [cut(asText(r.authorString), 120), journal].filter(Boolean).join(' · '),
        year: asText(r.pubYear) || null,
        url: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
        snippet: cut(plainOf(asText(r.abstractText)), SNIPPET),
      },
    ];
  });
}

// ClinicalTrials.gov

const TRIAL_FIELDS =
  'NCTId,BriefTitle,OverallStatus,StartDate,LeadSponsorName,EnrollmentCount,BriefSummary';

function trialOf(raw: unknown): Found | null {
  const p = asObject(asObject(raw).protocolSection);
  const id = asObject(p.identificationModule);
  const nct = asText(id.nctId);
  const title = asText(id.briefTitle);
  if (!/^NCT\d{8}$/.test(nct) || !title) return null;
  const status = asObject(p.statusModule);
  const sponsor = asText(asObject(asObject(p.sponsorCollaboratorsModule).leadSponsor).name);
  const count = asText(asObject(asObject(p.designModule).enrollmentInfo).count);
  const state = asText(status.overallStatus).replaceAll('_', ' ').toLowerCase();
  return {
    kind: 'trial',
    externalId: nct,
    title: cut(title, 300),
    detail: [sponsor, state, count && `${count} participants`].filter(Boolean).join(' · '),
    year: yearOf(asText(asObject(status.startDateStruct).date)),
    url: `https://clinicaltrials.gov/study/${nct}`,
    snippet: cut(asText(asObject(p.descriptionModule).briefSummary), SNIPPET),
  };
}

async function searchTrials(client: OutsideClient, args: SearchArgs): Promise<Found[]> {
  const url = new URL('https://clinicaltrials.gov/api/v2/studies');
  url.searchParams.set('query.term', args.query);
  url.searchParams.set('pageSize', String(args.limit));
  url.searchParams.set('fields', TRIAL_FIELDS);
  if (args.since) {
    url.searchParams.set('filter.advanced', `AREA[StartDate]RANGE[${args.since}-01-01,MAX]`);
  }
  const studies = asArray(asObject(await client.json(url, args.signal)).studies);
  return studies.map(trialOf).filter((f): f is Found => !!f);
}

// openFDA

/** What each part of openFDA is searched by: words in its text fields, or an FDA product code. */
const FDA = {
  '510k': {
    path: 'device/510k.json',
    text: ['device_name'],
    code: 'product_code',
    date: 'decision_date',
    sort: 'decision_date:desc',
  },
  classification: {
    path: 'device/classification.json',
    text: ['device_name', 'definition'],
    code: 'product_code',
    date: null,
    sort: null,
  },
  event: {
    path: 'device/event.json',
    text: ['device.generic_name', 'device.brand_name', 'mdr_text.text'],
    code: 'device.device_report_product_code',
    date: 'date_received',
    sort: 'date_received:desc',
  },
  recall: {
    path: 'device/recall.json',
    text: ['product_description', 'reason_for_recall'],
    code: 'product_code',
    date: 'event_date_initiated',
    sort: 'event_date_initiated:desc',
  },
  udi: {
    path: 'device/udi.json',
    text: ['brand_name', 'device_description'],
    code: 'product_codes.code',
    date: 'publish_date',
    sort: null,
  },
} as const;
type FdaDataset = keyof typeof FDA;

/**
 * openFDA's search: every word must appear (in any of the part's text fields), and a word of
 * three capital letters is an FDA product code.
 */
export function openFdaSearch(dataset: FdaDataset, query: string, since: number | null): string {
  const spec = FDA[dataset];
  const clauses = plainWords(query).map((word) => {
    if (/^[A-Z]{3}$/.test(word)) return `${spec.code}:${word}`;
    const w = word.toLowerCase().replace(/[^a-z0-9-]/g, '');
    return `(${spec.text.map((f) => `${f}:${w}`).join(' ')})`;
  });
  if (since && spec.date) {
    const from = dataset === 'event' ? `${since}0101` : `${since}-01-01`;
    const to = dataset === 'event' ? '30000101' : '3000-01-01';
    clauses.push(`${spec.date}:[${from} TO ${to}]`);
  }
  return clauses.join(' AND ');
}

function fdaFound(dataset: FdaDataset, raw: unknown): Found | null {
  const r = asObject(raw);
  switch (dataset) {
    case '510k': {
      const k = asText(r.k_number);
      if (!/^[KP]\d{6}$/.test(k)) return null;
      return {
        kind: 'clearance',
        externalId: k,
        title: cut(asText(r.device_name), 300),
        detail: asText(r.applicant),
        year: yearOf(asText(r.decision_date)),
        url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${k}`,
        snippet: `${asText(r.decision_description)}, ${asText(r.decision_date)}. Product code ${asText(r.product_code)}.`,
      };
    }
    case 'classification': {
      const code = asText(r.product_code);
      if (!/^[A-Z]{3}$/.test(code)) return null;
      return {
        kind: 'classification',
        externalId: code,
        title: cut(asText(r.device_name), 300),
        detail: [
          `Class ${asText(r.device_class)}`,
          asText(r.medical_specialty_description),
          asText(r.regulation_number) && `21 CFR ${asText(r.regulation_number)}`,
        ]
          .filter(Boolean)
          .join(' · '),
        year: null,
        url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPCD/classification.cfm?start_search=1&productcode=${code}`,
        snippet: cut(asText(r.definition), SNIPPET),
      };
    }
    case 'event': {
      const key = asText(r.mdr_report_key);
      if (!/^\d+$/.test(key)) return null;
      const device = asObject(asArray(r.device)[0]);
      const texts = asArray(r.mdr_text).map(asObject);
      const event =
        texts.find((t) => /description of event/i.test(asText(t.text_type_code))) ?? texts[0];
      return {
        kind: 'adverse_event',
        externalId: `MDR ${key}`,
        title: cut(
          `${asText(device.brand_name) || asText(device.generic_name)}: ${asText(r.event_type) || 'report'}`,
          300,
        ),
        detail: asText(device.manufacturer_d_name),
        year: yearOf(asText(r.date_received)),
        url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/detail.cfm?mdrfoi__id=${key}`,
        snippet: cut(asText(event?.text), SNIPPET),
      };
    }
    case 'recall': {
      const id = asText(r.cfres_id);
      if (!/^\d+$/.test(id)) return null;
      const product = asText(r.product_description).split('\n')[0] ?? '';
      return {
        kind: 'recall',
        externalId: asText(r.product_res_number) || `CFRES ${id}`,
        title: cut(`Recall: ${product}`, 300),
        detail: [asText(r.recalling_firm), asText(r.recall_status)].filter(Boolean).join(' · '),
        year: yearOf(asText(r.event_date_initiated)),
        url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm?id=${id}`,
        snippet: cut(asText(r.reason_for_recall), SNIPPET),
      };
    }
    case 'udi': {
      const ids = asArray(r.identifiers).map(asObject);
      const di = asText((ids.find((i) => asText(i.type) === 'Primary') ?? ids[0])?.id);
      if (!/^[A-Za-z0-9+.-]{4,40}$/.test(di)) return null;
      const model = asText(r.version_or_model_number);
      const code = asText(asObject(asArray(r.product_codes)[0]).code);
      return {
        kind: 'device',
        externalId: `DI ${di}`,
        title: cut(`${asText(r.brand_name)}${model ? ` (${model})` : ''}`, 300),
        detail: asText(r.company_name),
        year: yearOf(asText(r.publish_date)),
        url: `https://accessgudid.nlm.nih.gov/devices/${encodeURIComponent(di)}`,
        snippet: cut(
          [
            asText(r.device_description),
            asText(r.commercial_distribution_status),
            code && `Product code ${code}`,
          ]
            .filter(Boolean)
            .join('. '),
          SNIPPET,
        ),
      };
    }
  }
}

async function searchOpenFda(
  client: OutsideClient,
  args: SearchArgs,
  datasets: FdaDataset[],
): Promise<Found[]> {
  const each = Math.max(3, Math.ceil(args.limit / datasets.length));
  const found: Found[] = [];
  for (const dataset of datasets) {
    const spec = FDA[dataset];
    const url = new URL(`https://api.fda.gov/${spec.path}`);
    if (client.options.openFdaApiKey) url.searchParams.set('api_key', client.options.openFdaApiKey);
    url.searchParams.set('search', openFdaSearch(dataset, args.query, args.since));
    url.searchParams.set('limit', String(each));
    if (spec.sort) url.searchParams.set('sort', spec.sort);
    const results = asArray(asObject(await client.json(url, args.signal)).results);
    for (const r of results) {
      const f = fdaFound(dataset, r);
      if (f) found.push(f);
    }
  }
  return found.slice(0, args.limit);
}

// Crossref, for journals PubMed doesn't hold

async function searchCrossref(client: OutsideClient, args: SearchArgs, issn: string) {
  const url = new URL(`https://api.crossref.org/journals/${issn}/works`);
  url.searchParams.set('query', plainWords(args.query).join(' '));
  url.searchParams.set('rows', String(args.limit));
  url.searchParams.set('select', 'DOI,title,author,issued,container-title,abstract');
  if (args.since) url.searchParams.set('filter', `from-pub-date:${args.since}`);
  if (client.options.contactEmail) url.searchParams.set('mailto', client.options.contactEmail);
  const items = asArray(asObject(asObject(await client.json(url, args.signal)).message).items);
  return items.flatMap((raw): Found[] => {
    const r = asObject(raw);
    const doi = asText(r.DOI);
    const title = plainOf(asText(asArray(r.title)[0]));
    if (!/^10\.\d{4,9}\/\S+$/.test(doi) || !title) return [];
    const authors = asArray(r.author)
      .map((a) => asText(asObject(a).family))
      .filter(Boolean);
    const who =
      authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ');
    const year = asText(asArray(asArray(asObject(r.issued)['date-parts'])[0])[0]);
    return [
      {
        kind: 'article',
        externalId: `DOI ${doi}`,
        title: cut(title, 300),
        detail: [who, asText(asArray(r['container-title'])[0])].filter(Boolean).join(' · '),
        year: year || null,
        url: `https://doi.org/${doi}`,
        snippet: cut(plainOf(asText(r.abstract)), SNIPPET),
      },
    ];
  });
}

/** Searches one source of the library. Websites and links are not searched here. */
export async function searchSource(
  client: OutsideClient,
  settings: ResearchSourceSettings,
  args: SearchArgs,
): Promise<Found[]> {
  switch (settings.kind) {
    case 'pubmed':
      return searchPubmed(client, args, null);
    case 'europepmc':
      return searchEuropePmc(client, args);
    case 'clinicaltrials':
      return searchTrials(client, args);
    case 'openfda':
      return searchOpenFda(client, args, settings.datasets);
    case 'journal':
      return settings.pubmedTitle
        ? searchPubmed(client, args, settings.pubmedTitle)
        : searchCrossref(client, args, settings.issn);
    case 'website':
    case 'link':
      return [];
  }
}

/** A result in full, where the source has more than the search gave: an abstract, a trial's design, a report's narrative. */
export async function readFound(
  client: OutsideClient,
  found: Found,
  signal: AbortSignal,
): Promise<string> {
  const id = found.externalId;
  if (id.startsWith('PMID ')) {
    const pmid = id.slice(5);
    return cut((await pubmedAbstracts(client, [pmid], signal)).get(pmid) ?? found.snippet, READ);
  }
  if (/^NCT\d{8}$/.test(id)) {
    const url = new URL(`https://clinicaltrials.gov/api/v2/studies/${id}`);
    url.searchParams.set(
      'fields',
      `${TRIAL_FIELDS},DetailedDescription,PrimaryOutcome,EligibilityCriteria,DesignInfo`,
    );
    const p = asObject(asObject(await client.json(url, signal)).protocolSection);
    const description = asObject(p.descriptionModule);
    const outcomes = asArray(asObject(p.outcomesModule).primaryOutcomes)
      .map((o) => asText(asObject(o).measure))
      .filter(Boolean);
    const design = asObject(asObject(p.designModule).designInfo);
    return cut(
      [
        asText(description.briefSummary),
        asText(description.detailedDescription),
        outcomes.length > 0 && `Primary outcomes: ${outcomes.join('; ')}.`,
        asText(design.allocation) && `Allocation: ${asText(design.allocation)}.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      READ,
    );
  }
  if (id.startsWith('MDR ')) {
    const url = new URL('https://api.fda.gov/device/event.json');
    if (client.options.openFdaApiKey) url.searchParams.set('api_key', client.options.openFdaApiKey);
    url.searchParams.set('search', `mdr_report_key:${id.slice(4)}`);
    url.searchParams.set('limit', '1');
    const report = asObject(asArray(asObject(await client.json(url, signal)).results)[0]);
    const texts = asArray(report.mdr_text)
      .map(asObject)
      .map((t) => `${asText(t.text_type_code)}: ${asText(t.text)}`);
    return cut(texts.join('\n\n') || found.snippet, READ);
  }
  if (id.startsWith('DOI ')) {
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(id.slice(4))}`);
    if (client.options.contactEmail) url.searchParams.set('mailto', client.options.contactEmail);
    const work = asObject(asObject(await client.json(url, signal)).message);
    return cut(plainOf(asText(work.abstract)) || found.snippet, READ);
  }
  if (/^(MED|PMC|PPR|AGR|CBA|CTX|ETH|HIR|PAT) /.test(id)) {
    const [source, extId] = id.split(' ');
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    url.searchParams.set('query', `EXT_ID:${extId} AND SRC:${source}`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('resultType', 'core');
    const r = asObject(
      asArray(asObject(asObject(await client.json(url, signal)).resultList).result)[0],
    );
    return cut(plainOf(asText(r.abstractText)) || found.snippet, READ);
  }
  return found.snippet;
}
