import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Words typed into search, as a PostgreSQL full-text query: quotes for a phrase, `or`, and `-`
 * to leave a word out, as in a web search. English stemming, so "drafting" finds "draft".
 */
export const wordsQuery = (q: string): SQL => sql`websearch_to_tsquery('english', ${q})`;

/** `%q%` for ILIKE, with the user's own `%` and `_` taken literally: codes and names match partly. */
export const containing = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A few words around the match, without markup. */
export const snippetOf = (text: AnyColumn | SQL, q: string): SQL =>
  sql`ts_headline('english', ${text}, ${wordsQuery(q)}, 'MaxFragments=1, MaxWords=18, MinWords=6, StartSel="", StopSel=""')`;
